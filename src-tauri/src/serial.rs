//! USB serial ports, for a DCC-EX command station plugged into this computer: the desktop app's
//! web view can't use Web Serial, so the page reaches the port through these commands. What the
//! command station sends comes back to the page as "serial-data" events, and a port that goes away
//! as a "serial-closed" event.
use std::collections::HashMap;
use std::io::{ErrorKind, Read, Write};
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{AppHandle, Emitter, State};

struct Open {
    port: Box<dyn serialport::SerialPort>,
    stop: Arc<AtomicBool>,
}

#[derive(Default)]
pub struct Ports {
    open: Mutex<HashMap<u32, Open>>,
    next: AtomicU32,
}

/// A serial port the page can offer: its name ("COM3", "/dev/ttyACM0") and what's plugged in, if known.
#[derive(serde::Serialize)]
pub struct PortInfo {
    name: String,
    usb: bool,
    description: String,
}

#[derive(Clone, serde::Serialize)]
struct Data {
    id: u32,
    text: String,
}

#[derive(Clone, serde::Serialize)]
struct Closed {
    id: u32,
    error: Option<String>,
}

#[tauri::command]
pub fn serial_ports() -> Result<Vec<PortInfo>, String> {
    let ports = serialport::available_ports().map_err(|e| e.to_string())?;
    Ok(ports
        .into_iter()
        .map(|p| match p.port_type {
            serialport::SerialPortType::UsbPort(u) => PortInfo {
                name: p.port_name,
                usb: true,
                description: [u.manufacturer, u.product].into_iter().flatten().collect::<Vec<_>>().join(" "),
            },
            _ => PortInfo { name: p.port_name, usb: false, description: String::new() },
        })
        .collect())
}

/// Open a port at DCC-EX's 115200 baud. Returns the id to write to and close it by.
#[tauri::command]
pub fn serial_open(app: AppHandle, ports: State<Ports>, name: String) -> Result<u32, String> {
    let port = serialport::new(&name, 115_200)
        .timeout(Duration::from_millis(50))
        .open()
        .map_err(|e| format!("{name}: {e}"))?;
    let mut reader = port.try_clone().map_err(|e| e.to_string())?;
    let id = ports.next.fetch_add(1, Ordering::SeqCst) + 1;
    let stop = Arc::new(AtomicBool::new(false));
    let quit = stop.clone();
    ports.open.lock().unwrap().insert(id, Open { port, stop });
    std::thread::spawn(move || {
        let mut buf = [0u8; 1024];
        let error = loop {
            if quit.load(Ordering::SeqCst) {
                break None;
            }
            match reader.read(&mut buf) {
                Ok(0) => {}
                Ok(n) => {
                    let _ = app.emit("serial-data", Data { id, text: String::from_utf8_lossy(&buf[..n]).into_owned() });
                }
                Err(e) if e.kind() == ErrorKind::TimedOut || e.kind() == ErrorKind::Interrupted => {}
                Err(e) => break Some(e.to_string()),
            }
        };
        let _ = app.emit("serial-closed", Closed { id, error });
    });
    Ok(id)
}

#[tauri::command]
pub fn serial_write(ports: State<Ports>, id: u32, text: String) -> Result<(), String> {
    let mut open = ports.open.lock().unwrap();
    let p = open.get_mut(&id).ok_or("That port isn't open.")?;
    p.port.write_all(text.as_bytes()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn serial_close(ports: State<Ports>, id: u32) {
    if let Some(p) = ports.open.lock().unwrap().remove(&id) {
        p.stop.store(true, Ordering::SeqCst);
    }
}
