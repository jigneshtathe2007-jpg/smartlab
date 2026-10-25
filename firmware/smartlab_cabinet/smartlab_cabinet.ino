/*
  SmartLab cabinet firmware - Arduino Uno + MFRC522 + SG90 servo latch
  Library: "MFRC522" by GithubCommunity (Library Manager). Servo.h is built in.

  Wiring (RC522 is 3.3V ONLY):
    RC522 SDA(SS)->D10  SCK->D13  MOSI->D11  MISO->D12  RST->D9  3.3V->3.3V  GND->GND  (IRQ unused)
    Servo  brown->GND   red->5V   orange/yellow(signal)->D6

  Serial protocol (9600 baud, newline-terminated) - see backend/hardware.py
*/
#include <SPI.h>
#include <MFRC522.h>
#include <Servo.h>

#define SS_PIN 10
#define RST_PIN 9
#define SERVO_PIN 6

const int LOCKED_ANGLE = 0;      // adjust to your latch
const int UNLOCKED_ANGLE = 90;
const unsigned long HEARTBEAT_MS = 2000;
const unsigned long REREAD_GUARD_MS = 1200;

MFRC522 rfid(SS_PIN, RST_PIN);
Servo latch;

bool rfidOk = false;
bool unlocked = false;
unsigned long relockAt = 0;
unsigned long lastHeartbeat = 0;
unsigned long lastScanAt = 0;

char cmdBuf[24];
byte cmdLen = 0;

void printStatus(const __FlashStringHelper *prefix) {
  Serial.print(prefix);
  Serial.print(F(":RFID="));
  Serial.print(rfidOk ? F("OK") : F("FAIL"));
  Serial.print(F(":SERVO="));
  Serial.println(unlocked ? F("UNLOCKED") : F("LOCKED"));
}

void lockLatch() {
  latch.write(LOCKED_ANGLE);
  unlocked = false;
}

void unlockLatch(unsigned int seconds) {
  latch.write(UNLOCKED_ANGLE);
  unlocked = true;
  relockAt = millis() + (unsigned long)seconds * 1000UL;
}

void handleCommand(const char *c) {
  if (strcmp(c, "PING") == 0) {
    printStatus(F("PONG:SMARTLAB"));
  } else if (strcmp(c, "STATUS") == 0) {
    printStatus(F("HB"));
  } else if (strncmp(c, "UNLOCK", 6) == 0) {
    int secs = 5;
    if (c[6] == ':') secs = atoi(c + 7);
    if (secs < 1) secs = 1;
    if (secs > 30) secs = 30;
    unlockLatch(secs);
    Serial.println(F("ACK:UNLOCKED"));
  } else if (strcmp(c, "LOCK") == 0) {
    lockLatch();
    Serial.println(F("ACK:LOCKED"));
  } else {
    Serial.println(F("ERR:UNKNOWN_COMMAND"));
  }
}

void readSerial() {
  while (Serial.available()) {
    char ch = (char)Serial.read();
    if (ch == '\n' || ch == '\r') {
      if (cmdLen > 0) {
        cmdBuf[cmdLen] = '\0';
        handleCommand(cmdBuf);
        cmdLen = 0;
      }
    } else if (cmdLen < sizeof(cmdBuf) - 1) {
      cmdBuf[cmdLen++] = ch;
    } else {
      cmdLen = 0;  // overflow: discard
    }
  }
}

void readCard() {
  if (!rfidOk) return;
  if (millis() - lastScanAt < REREAD_GUARD_MS) return;
  if (!rfid.PICC_IsNewCardPresent() || !rfid.PICC_ReadCardSerial()) return;
  Serial.print(F("UID:"));
  for (byte i = 0; i < rfid.uid.size; i++) {
    if (rfid.uid.uidByte[i] < 0x10) Serial.print('0');
    Serial.print(rfid.uid.uidByte[i], HEX);   // upper-case hex, no separators
  }
  Serial.println();
  rfid.PICC_HaltA();
  rfid.PCD_StopCrypto1();
  lastScanAt = millis();
}

void setup() {
  Serial.begin(9600);
  latch.attach(SERVO_PIN);
  lockLatch();
  SPI.begin();
  rfid.PCD_Init();
  byte v = rfid.PCD_ReadRegister(MFRC522::VersionReg);
  rfidOk = (v != 0x00 && v != 0xFF);       // 0x00/0xFF = no reader answering on SPI
  Serial.println(F("READY:SMARTLAB"));
}

void loop() {
  readSerial();
  readCard();
  if (unlocked && (long)(millis() - relockAt) >= 0) {
    lockLatch();
    Serial.println(F("ACK:LOCKED"));       // auto re-lock
  }
  if (millis() - lastHeartbeat >= HEARTBEAT_MS) {
    lastHeartbeat = millis();
    printStatus(F("HB"));
  }
}
