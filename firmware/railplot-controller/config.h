// Railplot controller settings. Change these, then upload the firmware.
#pragma once

// Your home Wi-Fi. Leave WIFI_SSID empty to make the controller its own network instead
// (connect your phone to AP_SSID and open http://192.168.4.1).
#define WIFI_SSID     ""
#define WIFI_PASSWORD ""

// The controller's own network, used when WIFI_SSID is empty or can't be reached.
#define AP_SSID       "Railplot"
#define AP_PASSWORD   "railplot-trains"   // at least 8 characters

// Name on the network: phones and laptops open http://railplot.local
// Give a second controller a different name, e.g. "railplot-2".
#define HOSTNAME      "railplot"

// Which block driver boards you used:
//   DRIVER_DRV8876  Pololu DRV8876 carrier (PH/EN, with current sensing): EN=PWM, PH=direction, CS=current
//   DRIVER_DRV8871  cheap DRV8871 modules (IN1/IN2, no current sensing): the EN pin goes to IN1, the PH pin to IN2
#define DRIVER_DRV8876 1
#define DRIVER_DRV8871 2
#define DRIVER_TYPE   DRIVER_DRV8876

// Track power PWM frequency. 20000 Hz is silent and suits coreless and modern can motors.
// Older open-frame motors (Hornby ringfield, Triang) often run more smoothly at 100 Hz.
#define PWM_HZ        20000

// Stop all trains if no phone or laptop has sent anything for this long (milliseconds).
#define WATCHDOG_MS   1500

// Infrared sensor modules pull their output low when they see a train.
#define SENSOR_ACTIVE_LOW 1

// Detecting trains by current in blocks with no power: every DETECT_PERIOD_MS each idle block gets a
// full-voltage pulse of DETECT_PULSE_US microseconds (too short to move a loco) while its current is
// measured. Railplot reads it when "Detect trains by the current they draw" is on. 0 turns the pulses off.
// DRV8876 drivers only: DRV8871 modules can't measure current.
#define DETECT_PERIOD_MS 100
#define DETECT_PULSE_US  600

// Servo speed: microseconds of travel per 20 ms step. 6 gives a slow, prototypical throw.
#define SERVO_STEP_US 6
