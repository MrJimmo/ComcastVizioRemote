/*
    ComcastVizioRemote

    This project is a basic Remote Emulator style of gimmick.

    When powered up, it attempts to connect to a known WIFI AP (or fall back to
    a secondary if first one not found...this is just a peculiarity of my
    environment).

    Once powered up and connected to WIFI, it can then receive HTTP traffic via
    the ESP8266WebServer functionality.

    The main function of the code is to receive POSTs that contain IR Code
    details (Protocol and IR Code), and then emit the codes via the IR LEDs 
    (ESP8266 Pins D1, D2), using the IR Send functionality of IRremoteESP8266
    library.

    Though the project provides a default web experience when connecting to
    the device IP address, it's not necessary to load the HTML/CSS/Script
    from the device, you can roll your own HTML or HTTP solution and host
    elsewhere, as long as it can 'see' this device IP and create and send the
    POSTs.

    POSTs are a simple format of:
    { 'IR_PROTOCOL' : 'NEC', 'IR_CODE' : '0x20DF10EF' }
    { 'IR_PROTOCOL' : 'XMP', 'IR_CODE' : '0x170F443E19000600' }
    { 'IR_PROTOCOL' : 'XMP', 'IR_CODE' : '0x170F443E17002600' }

    First value 0x20DF10EF as NEC, second and third are sending XMP codes for
    "6" and "Info" respectively.

    With the device processing this simple payload, it opens up a wide variety
    of scenarios, driven by whatever creates and sends the POSTs.


    [Reference / Acknowledgements]
    Most of the IR code below is from/based on the IRRemoteESP8266 examples:
    https://github.com/crankyoldgit/IRremoteESP8266/

    Much of the sample code & comments have been pruned and edited for brevity
    or clarity for this implementation.  Refer to the documentation for those
    libraries for better details and info on how they work.

MIT License

Copyright (c) 2025 Jim Moore

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
*/
#include <ESP8266WiFi.h>
#include <ESP8266WebServer.h>
#include <IRremoteESP8266.h>
#include <IRsend.h>
#include <IRrecv.h>
#include <ArduinoJson.h>
#include <stdlib.h>

#include "network_details.h" // Contains WIFI_PASSWORD and WIFI_SSID_1|2

 // Script and Style files minimized using the VSCode plugin
 // MinifyAll by Jose Gracia Berenguer
#include "script_js.h"
#include "style_css.h"

#include "index.h"

ESP8266WebServer server;

/*
We use 2 different pins, to allow using 2 different IR LEDs, since these are
going to be positioned in different physical locations.  Depending on other
TV/Cable/etc. setups, it may only be necessary to wire up one LED.
*/
const uint16_t IR_NEC_LED = 4; // ESP8266 GPIO Pin 4 (D2).
const uint16_t IR_XMP_LED = 5; // ESP8266 GPIO Pin 5 (D1).

IRsend irsendNEC(IR_NEC_LED);  // Set the GPIO
IRsend irsendXMP(IR_XMP_LED);  // Set the GPIO

/*
Hacky way to retry a certain number of times
Try for up to 10 seconds. Max retry time is (WIFI_MAX_RETRY *
WIFI_MAX_RETRY_WAIT)ms
Ex. With WIFI_MAX_RETRY == 6 and WIFI_MAX_RETRY_WAIT == 1000*10 == 10s
    We'll retry 6 times, 10s each, so total of ~1min

In general, it connects the first time to the first SSID tried, so the retry
logic is kind of pointless.
*/
#define WIFI_MAX_RETRY 6                 // 6 retries
#define WIFI_MAX_RETRY_WAIT (1000 * 10)  // 10 seconds

#define WIFI_RETRY_DELAY 1000 //Time between individual retries, in ms

/*
getUIInt64fromHex

This function Copied From IRMQTTServer.h in
.pio\libdeps\esp01\IRremoteESP8266\examples\IRMQTTServer\IRMQTTServer.h
Arduino framework doesn't support strtoull(), so make our own one.
*/
uint64_t getUInt64fromHex(char const *str) {
    uint64_t result = 0;
    uint16_t offset = 0;
    // Skip any leading '0x' or '0X' prefix.
    if (str[0] == '0' && (str[1] == 'x' || str[1] == 'X')) {
        offset = 2;
    }

    for (; isxdigit((unsigned char)str[offset]); offset++) {
        char c = str[offset];
        result *= 16;
        if (isdigit(c))
            result += c - '0';  // '0' .. '9'
        else if (isupper(c))
            result += c - 'A' + 10;  // 'A' .. 'F'
        else
            result += c - 'a' + 10;  // 'a' .. 'f'
    }
    return result;
}

/*
ConnectoToWifi

This function handles attempting to connect to the given target SSID.
If unsuccessful after max tries, it will return false.
If connection is made before reaching max retries, it will return true.

In general, it connects the first time to the first SSID tried, so the retry
logic is rarely exercised.

Assumes Serial.begin was already called.
*/
bool ConnectToWifi(const char* wifiSSID, const char* wifiPassword) {
    int retry     = 0;
    int retryTime = 0;

    while (retry <= WIFI_MAX_RETRY)
    {
        Serial.printf("\nAttempt #%d to connect to SSID: %s\n", retry,
            wifiSSID);

        WiFi.begin(wifiSSID, wifiPassword);

        retryTime = 0; // Reset the total retry time.

        while ((WiFi.status() != WL_CONNECTED) &&
                (retryTime < WIFI_MAX_RETRY_WAIT)) {
            Serial.print(".");
            delay(WIFI_RETRY_DELAY);
            retryTime += WIFI_RETRY_DELAY;
        }

        if (WiFi.status() == WL_CONNECTED)
        {
            // Succesfully connected
            IPAddress ipAddress(WiFi.localIP());
            String localIP( String(ipAddress[0]) + String(".") +
                            String(ipAddress[1]) + String(".") +
                            String(ipAddress[2]) + String(".") +
                            String(ipAddress[3]) );
            Serial.println("");
            Serial.printf("Connected to SSID: %s\n", wifiSSID);
            Serial.printf("IP Address       : %s\n", localIP.c_str());
            Serial.printf("MAC              : %s\n", WiFi.macAddress().c_str());
            return true;
        }

        // Only get here, if we failed to connect, so try again.
        retry++;
    }

    // Failed to connect before hitting max retry
    if (retry > WIFI_MAX_RETRY)
    {
        Serial.printf("Failed to connect to SSID: %s\n", wifiSSID);
        Serial.printf("After %d tries (%dms)\n", WIFI_MAX_RETRY,
            WIFI_MAX_RETRY_WAIT);
        return false;
    }

    return false;
}

/*
sendRemoteButton

Simple wrapper around irSend calls.  Pivots on IR_LED to decided if it should
call sendNEC or sendXmp.

This is because the Comcast Digital receiver box takes XMP and using the
the IR_LED value easiest way to pivot the calls.
*/
void sendRemoteButton(const uint64_t buttonValue, uint32_t IR_LED)
{
    if (IR_LED == IR_NEC_LED) {
        Serial.printf("Sending Button value (NEC): 0x%08X\n", buttonValue);
        irsendNEC.sendNEC(buttonValue, kNECBits, kNoRepeat);
    } else if (IR_LED == IR_XMP_LED) {
        Serial.printf("Sending Button value (XMP): 0x%016llx\n",buttonValue);
        irsendXMP.sendXmp(buttonValue, kXmpBits, kNoRepeat);
    } else {
        Serial.printf("Unknown LED TYPE %d. Button value: 0x%016llx\n", IR_LED,
            buttonValue);
    }
}

/*
Web Server route handlers.

Simple routing for handling Default (index.html) as well as script and css
files.  This is really only necessary when loading the index from the device.
You can always create your own HTML file, hosted anywhere (that can send to
the device IP), and deal with resource loading in other ways.
*/

// "http://<IP>/"
void onRoot()
{
    server.send(200, "text/html", index_html);
    delay(2000);
}

// "http://<IP>/style.css", LINK tag in index.html
void loadStyleSheet()
{
    server.send(200, "text/css", style_css);
}

// "http://<IP>/script.js"  SCRIPT tag in index.html
void loadScript()
{
    server.send(200, "text/javascript", script_js);
}

/*
onRemoteControl

This routine handles the incoming POST to "http://<IP>/remoteControl"

Body of the request will be something like one of the following:
{ 'IR_PROTOCOL' : 'XMP', 'IR_CODE' : '0x170F443E14008300' }
{ 'IR_PROTOCOL' : 'NEC', 'IR_CODE' : '0x20DFA857' }

The JSON is parsed and the IR protocol and code sent in a call to
sendRemoteButton.
*/
void onRemoteControl()
{
    // Checks to see if there's anything in the body of the inbound request.
    if (server.hasArg("plain") == false){
        server.send(400, "text/plain", "**** Body not received.");
        return;
    }

    JsonDocument jDoc;

    deserializeJson(jDoc, server.arg("plain"));

    const char* ir_protocol = jDoc["IR_PROTOCOL"];
    const char* ir_code   = jDoc["IR_CODE"];

    String irProtocol = String(ir_protocol);
    String irCode   = String(ir_code);

    // Not necessary, but helpful during dev/debugging.
    char response_body[1024];

    int    responseCode = 200;
    String results      = String("SUCCESS");

    // Call sendRemoteButton with with LED appropriate for given code protocol.
    if (irProtocol.equalsIgnoreCase("NEC")) {
        sendRemoteButton(getUInt64fromHex(irCode.c_str()), IR_NEC_LED);
    } else if (irProtocol.equalsIgnoreCase("XMP")) {
        sendRemoteButton(getUInt64fromHex(irCode.c_str()), IR_XMP_LED);
    } else {
        Serial.printf("[onRemoteControl] **** Unknown irProtocol: %s\n",
            irProtocol.c_str());
        results = "FAILED. Check code protocol.";
        responseCode = 400;
    }

    delay(300); // Delay needed, otherwise TV/Cable box get lost.

    // Used mostly during dev/debugging, simple response with success/failure
    // for the given client HTTP Request.
    sprintf(response_body,
        "{IR_CODE_RECEIVED:%s IR_PROTOCOL:%s, IR_CODE:%s}",
        results.c_str(), irProtocol.c_str(), irCode.c_str());
    Serial.printf("RESPONSE_BODY: %s\n", response_body);

    String response = String(response_body);
    server.sendHeader("Access-Control-Allow-Origin", "*");
    server.sendHeader("Access-Control-Allow-Methods", "PUT,POST,GET,OPTIONS");
    server.send ( responseCode, "text/json", response);
}

void setup()
{
    Serial.begin(115200);

    // Try the first SSID, if no connect, try second.
    // ConnectToWifi handles multiple tries.
    if (!ConnectToWifi(WIFI_SSID_1, WIFI_PASSWORD))
    {
        Serial.println("Trying secondary WIFI SSID");
        ConnectToWifi(WIFI_SSID_2, WIFI_PASSWORD);
    }

    // Setup Web routes
    server.on("/", onRoot);
    server.on("/style.css", loadStyleSheet);
    server.on("/script.js", loadScript);
    server.on("/remoteControl", onRemoteControl);
    server.begin();

    irsendNEC.begin();
    irsendXMP.begin();
}

void loop()
{
    server.handleClient();
}
