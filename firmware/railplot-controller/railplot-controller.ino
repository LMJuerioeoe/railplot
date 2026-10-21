// Railplot controller firmware for ESP32 (Arduino core 2.x or 3.x).
//
//  - 6 block drivers (Pololu DRV8876 carriers, PH/EN mode) for analogue track power, with current sensing
//  - servos for points on PCA9685 boards at I2C 0x40-0x43 (servo numbers 0-63)
//  - LEDs for signals and lights on PCA9685 boards at 0x44-0x47 (output numbers 0-63)
//  - infrared train sensors on MCP23017 boards at 0x20-0x27 (input numbers 0-127)
//  - an HTTP API that Railplot talks to, and the Railplot app itself for phones at http://railplot.local
//
// All the thinking (which block gets which train's power, signals, following trains) happens in Railplot.
// This board just does what the latest frame says, and stops the trains if frames stop arriving.

#include <Arduino.h>
#include <WiFi.h>
#include <WebServer.h>
#include <ESPmDNS.h>
#include <Wire.h>
#include <LittleFS.h>
#include "config.h"

static const char* FW = "railplot-controller 0.4.0";

struct BlockPins { uint8_t en, ph, cs; };
// EN takes the PWM, PH sets the direction, CS is the driver's current output (ADC1 pins only, so Wi-Fi can run).
static const BlockPins BLOCKS[6] = { {25, 26, 36}, {27, 14, 39}, {13, 4, 34}, {16, 17, 35}, {18, 19, 32}, {23, 5, 33} };
static const int NBLOCKS = 6;
static const int PWM_BITS = 10;          // duty 0..1023
static const uint8_t LED_PIN = 2;

WebServer server(80);

int16_t duty[NBLOCKS];                   // -1023..1023
float mA[NBLOCKS];
float idleMA[NBLOCKS];                    // current during the last detection pulse, blocks with no power
uint32_t lastFrameMs = 0;
bool stopped = true;
String driver;
uint32_t driverMs = 0;

struct ServoState { uint16_t target = 0, current = 0; uint32_t settledAt = 0; bool powered = false; };
ServoState servos[64];
uint16_t outLevel[64];
bool servoBoard[4], ledBoard[4], sensorBoard[8];
uint16_t inputLatch[8];

// ---------- PWM (works with Arduino core 2.x and 3.x) ----------
// Channel numbers for core 2.x: EN pins use channels 0-5, PH pins (DRV8871 IN2) use 6-11.
void pwmAttachPin(uint8_t pin, int channel) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcAttach(pin, PWM_HZ, PWM_BITS);
#else
  ledcSetup(channel, PWM_HZ, PWM_BITS);
  ledcAttachPin(pin, channel);
#endif
}
void pwmWritePin(uint8_t pin, int channel, uint32_t v) {
#if ESP_ARDUINO_VERSION_MAJOR >= 3
  ledcWrite(pin, v);
#else
  ledcWrite(channel, v);
#endif
}
void pwmAttach(int i) {
  pwmAttachPin(BLOCKS[i].en, i);
#if DRIVER_TYPE == DRIVER_DRV8871
  pwmAttachPin(BLOCKS[i].ph, i + NBLOCKS);
#endif
}
void pwmWrite(int i, uint32_t v) { pwmWritePin(BLOCKS[i].en, i, v); }

void applyBlock(int i) {
  int16_t d = duty[i];
  uint32_t a = (uint32_t)abs(d);
#if DRIVER_TYPE == DRIVER_DRV8871
  // IN1/IN2: forward drives IN1, reverse drives IN2, the other input stays low
  pwmWritePin(BLOCKS[i].en, i, d >= 0 ? a : 0);
  pwmWritePin(BLOCKS[i].ph, i + NBLOCKS, d < 0 ? a : 0);
#else
  digitalWrite(BLOCKS[i].ph, d >= 0 ? HIGH : LOW);
  pwmWrite(i, a);
#endif
}

void allStop() {
  for (int i = 0; i < NBLOCKS; i++) { duty[i] = 0; applyBlock(i); }
  stopped = true;
}

// ---------- I2C boards ----------
bool present(uint8_t addr) { Wire.beginTransmission(addr); return Wire.endTransmission() == 0; }
void write8(uint8_t addr, uint8_t reg, uint8_t v) { Wire.beginTransmission(addr); Wire.write(reg); Wire.write(v); Wire.endTransmission(); }

void pcaInit(uint8_t addr, float hz) {
  uint8_t prescale = (uint8_t)(round(25000000.0 / (4096.0 * hz)) - 1);
  write8(addr, 0x00, 0x10);               // MODE1: sleep so the prescaler can be set
  write8(addr, 0xFE, prescale);
  write8(addr, 0x00, 0x20);               // wake, register auto-increment
  delay(1);
  write8(addr, 0x00, 0xA0);               // restart
  write8(addr, 0x01, 0x04);               // MODE2: totem-pole outputs
}
void pcaSet(uint8_t addr, uint8_t ch, uint16_t on, uint16_t off) {
  Wire.beginTransmission(addr);
  Wire.write(0x06 + 4 * ch);
  Wire.write(on & 0xFF); Wire.write(on >> 8);
  Wire.write(off & 0xFF); Wire.write(off >> 8);
  Wire.endTransmission();
}
void pcaLevel(uint8_t addr, uint8_t ch, uint16_t level) {
  if (level == 0) pcaSet(addr, ch, 0, 0x1000);            // full off
  else if (level >= 4095) pcaSet(addr, ch, 0x1000, 0);    // full on
  else pcaSet(addr, ch, 0, level);
}

void setServoPulse(int n, uint16_t us) {
  if (!servoBoard[n / 16]) return;
  uint16_t counts = (uint16_t)((uint32_t)us * 4096UL * 50UL / 1000000UL);
  pcaSet(0x40 + n / 16, n % 16, 0, counts);
}

void setOutput(int n, uint16_t level) {
  if (n < 0 || n >= 64 || outLevel[n] == level) return;
  outLevel[n] = level;
  if (ledBoard[n / 16]) pcaLevel(0x44 + n / 16, n % 16, level);
}

void scanBoards() {
  for (int b = 0; b < 4; b++) {
    servoBoard[b] = present(0x40 + b);
    if (servoBoard[b]) { pcaInit(0x40 + b, 50); for (int c = 0; c < 16; c++) pcaSet(0x40 + b, c, 0, 0x1000); }
    ledBoard[b] = present(0x44 + b);
    if (ledBoard[b]) { pcaInit(0x44 + b, 1000); for (int c = 0; c < 16; c++) pcaLevel(0x44 + b, c, 0); }
  }
  for (int b = 0; b < 8; b++) {
    sensorBoard[b] = present(0x20 + b);
    if (sensorBoard[b]) {
      write8(0x20 + b, 0x00, 0xFF); write8(0x20 + b, 0x01, 0xFF);   // all inputs
      write8(0x20 + b, 0x0C, 0xFF); write8(0x20 + b, 0x0D, 0xFF);   // pull-ups on
    }
  }
}

void readSensors() {
  for (int b = 0; b < 8; b++) {
    if (!sensorBoard[b]) continue;
    Wire.beginTransmission(0x20 + b); Wire.write(0x12); Wire.endTransmission();
    if (Wire.requestFrom((int)(0x20 + b), 2) != 2) continue;
    uint16_t v = Wire.read(); v |= (uint16_t)Wire.read() << 8;
    inputLatch[b] |= SENSOR_ACTIVE_LOW ? (uint16_t)~v : v;     // remember every pass until reported
  }
}

// Move servos slowly towards their targets; switch the pulse off once settled so they don't buzz.
void stepServos() {
  uint32_t now = millis();
  for (int n = 0; n < 64; n++) {
    ServoState& s = servos[n];
    if (!s.target) continue;
    if (!s.current) s.current = s.target;               // first command after power-up: go straight there
    if (s.current != s.target) {
      int diff = (int)s.target - (int)s.current;
      int step = constrain(diff, -SERVO_STEP_US, SERVO_STEP_US);
      s.current += step;
      setServoPulse(n, s.current);
      s.powered = true;
      s.settledAt = now;
    } else if (s.powered && now - s.settledAt > 700) {
      if (servoBoard[n / 16]) pcaSet(0x40 + n / 16, n % 16, 0, 0x1000);
      s.powered = false;
    } else if (!s.powered && s.settledAt == 0) {
      setServoPulse(n, s.current); s.powered = true; s.settledAt = now;
    }
  }
}

// ---------- HTTP API ----------
void cors() {
  server.sendHeader("Access-Control-Allow-Origin", "*");
  server.sendHeader("Cache-Control", "no-store");
}

// "ch:value,ch:value"
template <typename F> void parsePairs(const String& s, F fn) {
  int i = 0;
  while (i < (int)s.length()) {
    int comma = s.indexOf(',', i); if (comma < 0) comma = s.length();
    int colon = s.indexOf(':', i);
    if (colon > i && colon < comma) fn(s.substring(i, colon).toInt(), s.substring(colon + 1, comma).toInt());
    i = comma + 1;
  }
}

String statusJson(bool accepted, bool clearInputs) {
  String j; j.reserve(400);
  j += "{\"fw\":\""; j += FW; j += "\",\"name\":\""; j += HOSTNAME; j += "\",\"driver\":\""; j += driver;
  j += "\",\"accepted\":"; j += accepted ? "true" : "false";
  j += ",\"stopped\":"; j += stopped ? "true" : "false";
  j += ",\"in\":[";
  for (int b = 0; b < 8; b++) { if (b) j += ','; j += inputLatch[b]; if (clearInputs) inputLatch[b] = 0; }
  j += "],\"mA\":[";
  for (int i = 0; i < NBLOCKS; i++) { if (i) j += ','; j += (int)mA[i]; }
#if DRIVER_TYPE != DRIVER_DRV8871 && DETECT_PERIOD_MS > 0
  j += "],\"dmA\":[";
  for (int i = 0; i < NBLOCKS; i++) { if (i) j += ','; j += (int)idleMA[i]; }
#endif
  j += "],\"boards\":{\"servo\":"; int n = 0; for (int b = 0; b < 4; b++) n += servoBoard[b]; j += n;
  j += ",\"led\":"; n = 0; for (int b = 0; b < 4; b++) n += ledBoard[b]; j += n;
  j += ",\"sensor\":"; n = 0; for (int b = 0; b < 8; b++) n += sensorBoard[b]; j += n;
  j += "}}";
  return j;
}

void handleFrame() {
  String cid = server.arg("cid");
  bool take = server.arg("take") == "1";
  uint32_t now = millis();
  bool accept = cid.length() && (driver.length() == 0 || driver == cid || now - driverMs > 3000 || take);
  if (accept) {
    if (driver != cid) Serial.printf("Now driven by %s\n", cid.c_str());
    driver = cid; driverMs = now; lastFrameMs = now; stopped = false;
    parsePairs(server.arg("b"), [](int ch, int v) { if (ch >= 0 && ch < NBLOCKS) { duty[ch] = constrain(v, -1023, 1023); applyBlock(ch); } });
    parsePairs(server.arg("s"), [](int n, int us) { if (n >= 0 && n < 64 && us >= 500 && us <= 2500 && servos[n].target != us) { servos[n].target = us; servos[n].settledAt = 0; } });
    parsePairs(server.arg("o"), [](int n, int level) { setOutput(n, constrain(level, 0, 4095)); });
  }
  cors();
  server.send(200, "application/json", statusJson(accept, accept));
}

void handleStatus() { cors(); server.send(200, "application/json", statusJson(false, false)); }

// Uploads (the Railplot app, the layout) stream straight to flash.
File uploadFile;
String uploadTarget;
void handleUploadData() {
  HTTPUpload& up = server.upload();
  if (up.status == UPLOAD_FILE_START) uploadFile = LittleFS.open(uploadTarget + ".tmp", "w");
  else if (up.status == UPLOAD_FILE_WRITE && uploadFile) uploadFile.write(up.buf, up.currentSize);
  else if (up.status == UPLOAD_FILE_END && uploadFile) {
    uploadFile.close();
    LittleFS.remove(uploadTarget);
    LittleFS.rename(uploadTarget + ".tmp", uploadTarget);
  }
}
void uploadDone() { cors(); server.send(200, "application/json", "{\"ok\":true}"); }

void sendFile(const char* path, const char* type) {
  cors();
  String gz = String(path) + ".gz";
  if (LittleFS.exists(gz)) { File f = LittleFS.open(gz, "r"); server.streamFile(f, type); f.close(); return; }
  if (LittleFS.exists(path)) { File f = LittleFS.open(path, "r"); server.streamFile(f, type); f.close(); return; }
  server.send(404, "text/plain", "Not found");
}

void handleRoot() {
  if (!LittleFS.exists("/index.html") && !LittleFS.exists("/index.html.gz")) {
    cors();
    server.send(200, "text/html", F("<!doctype html><meta name=viewport content='width=device-width'><title>Railplot controller</title>"
      "<body style='font:16px system-ui;padding:24px;max-width:36em'><h1>Railplot controller</h1>"
      "<p>This controller is running, but the Railplot app isn't installed on it yet.</p>"
      "<p>Open Railplot on your computer, go to <b>Control &gt; Set up</b>, add this controller and press <b>Install Railplot on the controller</b>.</p>"));
    return;
  }
  sendFile("/index.html", "text/html");
}

void setupWifi() {
  WiFi.setHostname(HOSTNAME);
  bool joined = false;
  if (strlen(WIFI_SSID)) {
    WiFi.mode(WIFI_STA);
    WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
    Serial.printf("Joining %s", WIFI_SSID);
    for (int i = 0; i < 60 && WiFi.status() != WL_CONNECTED; i++) { delay(250); Serial.print('.'); }
    joined = WiFi.status() == WL_CONNECTED;
    Serial.println();
  }
  if (joined) Serial.printf("On %s as %s (http://%s.local)\n", WIFI_SSID, WiFi.localIP().toString().c_str(), HOSTNAME);
  else {
    WiFi.mode(WIFI_AP);
    WiFi.softAP(AP_SSID, AP_PASSWORD);
    Serial.printf("Own network %s, open http://%s\n", AP_SSID, WiFi.softAPIP().toString().c_str());
  }
  WiFi.setSleep(false);
  if (MDNS.begin(HOSTNAME)) MDNS.addService("http", "tcp", 80);
}

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  for (int i = 0; i < NBLOCKS; i++) {
#if DRIVER_TYPE != DRIVER_DRV8871
    pinMode(BLOCKS[i].ph, OUTPUT);
    digitalWrite(BLOCKS[i].ph, HIGH);
#endif
    pwmAttach(i);
    duty[i] = 0;
    applyBlock(i);
    analogSetPinAttenuation(BLOCKS[i].cs, ADC_11db);
  }
  Wire.begin(21, 22);
  Wire.setClock(400000);
  scanBoards();
  if (!LittleFS.begin(true)) Serial.println("Couldn't start the file system");
  setupWifi();

  server.on("/", HTTP_GET, handleRoot);
  server.on("/index.html", HTTP_GET, handleRoot);
  server.on("/api/frame", HTTP_GET, handleFrame);
  server.on("/api/status", HTTP_GET, handleStatus);
  server.on("/api/layout", HTTP_GET, []() { sendFile("/layout.json", "application/json"); });
  server.on("/api/layout", HTTP_POST, uploadDone, []() { uploadTarget = "/layout.json"; handleUploadData(); });
  server.on("/api/app", HTTP_POST, uploadDone, []() { uploadTarget = "/index.html"; LittleFS.remove("/index.html.gz"); handleUploadData(); });
  server.on("/api/session", HTTP_GET, []() { sendFile("/session.json", "application/json"); });
  server.on("/api/session", HTTP_POST, []() {
    File f = LittleFS.open("/session.json", "w");
    if (f) { f.print(server.arg("plain")); f.close(); }
    cors(); server.send(200, "application/json", "{\"ok\":true}");
  });
  server.on("/api/rescan", HTTP_GET, []() { scanBoards(); handleStatus(); });
  server.onNotFound([]() { cors(); server.send(404, "text/plain", "Not found"); });
  server.begin();
  Serial.println(FW);
}

void loop() {
  server.handleClient();
  uint32_t now = millis();

  static uint32_t lastSensors = 0, lastServo = 0, lastCurrent = 0;
  if (now - lastSensors >= 5) { lastSensors = now; readSensors(); }
  if (now - lastServo >= 20) { lastServo = now; stepServos(); }
  if (now - lastCurrent >= 20) {
    lastCurrent = now;
#if DRIVER_TYPE != DRIVER_DRV8871
    for (int i = 0; i < NBLOCKS; i++) {
      float v = analogReadMilliVolts(BLOCKS[i].cs) / 2.49f;     // DRV8876 carrier: about 2.5 V per amp
      mA[i] = mA[i] * 0.7f + v * 0.3f;
    }
#endif
  }
#if DRIVER_TYPE != DRIVER_DRV8871 && DETECT_PERIOD_MS > 0
  // detection pulses: one idle block at a time, so no block is pulsed more often than the period
  static uint32_t lastDetect = 0;
  static int detectNext = 0;
  if (!stopped && now - lastDetect >= DETECT_PERIOD_MS / NBLOCKS) {
    lastDetect = now;
    int i = detectNext; detectNext = (detectNext + 1) % NBLOCKS;
    if (duty[i] == 0) {
      pwmWrite(i, (1 << PWM_BITS) - 1);
      delayMicroseconds(DETECT_PULSE_US);
      float v = 0;
      for (int k = 0; k < 4; k++) v += analogReadMilliVolts(BLOCKS[i].cs);
      pwmWrite(i, 0);
      idleMA[i] = idleMA[i] * 0.5f + (v / 4 / 2.49f) * 0.5f;
    } else idleMA[i] = 0;
  }
#endif
  // safety: no frames, no power
  if (!stopped && now - lastFrameMs > WATCHDOG_MS) { allStop(); Serial.println("No commands: trains stopped"); }
  digitalWrite(LED_PIN, stopped ? ((now / 500) & 1) : HIGH);
}
