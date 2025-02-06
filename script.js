"use strict";

/*
This is the unminified, raw script file that gets compressed and copied into
script-min.js, when using the https://github.com/Josee9988/MinifyAll VSCode
plugin (Ctrl+Alt+N, which creates the script-min.js).

The contents of script-min.js, is what is then manually copied into script_js.h,
which defines the script_js string, and is eventually returned in response to
the <script src="script.js"></script> tag in the main HTML file.

main.cpp uses ESP8266WebServer and defines this "/script.js" route, so the
script tag ultimately retrives this file.

Any edits in this file then require it to be re-minified and then copied into
the script_js variable.

If this were a more complicated project, some other automated way of
updating the script_js variable would be employed.  For now, this works
just fine.

*/


/*
This FIFO 'queue' will be filled with objects containing the IR protocl and code
to be sent to the device.

Using a queue prevents UI interaction from stomping on codes and possibly
confusing the device if there's lag somewhere.

Each entry is an object: {"IR_PROTOCOL":<NEC|XMP>, "IR_CODE":<CODE>}
*/
let g_IRCodeQueue = [];

/*
When the page is loaded from the device, this will get set to location.host.
Can be overridden by adding "host_ip=<IP>" in the URL, which allows for local
dev/debugging of the html/script files, but still point to the 'live' device.
*/
let g_HostIP = undefined;

/*
sendIRCode

This function handles sending the given code of the specified protocol, back to
the ESP8266 as a POST with JSON payload in the following format...

{
    "IR_PROTOCOL" : "XMP" |  "NEC",
    "IR_CODE"     : "0x170F443E17002600" | "0x20DF10EF" | ...
}

It's expected that this function gets called for each IR code that is being
sent, meaning that the device will just receive a simple JSON object with 
IR Protocol and Code specified.

With the device consuming these PROTOCOL/CODE combos, it should allow for some
future experiments for different TV sets or other devices that will respond
to the IR LEDs that are connected to the ESP8266

Example:
If the IR receiver for color LED strip is near by, sending PROTOCOL/CODE combos
should be possible ...as long as it's NEC or XMP value.
*/
function sendIRCode(ir_protocol, ir_code) {

    // If g_HostIP is still undefined at this point, bail.
    // See processQueryParameters() for initial logic of setting this value.
    if (!g_HostIP) {
        outputDebugString(`[sendIRCode] **** No Host IP defined.`)
        outputDebugString(`[sendIRCode] If loading from file:///, add ` +
            `\"host_up=<IP>\" to specify IP of device.`);
        return;
    }

    let strURL  = `http://${g_HostIP}/remoteControl`;

    let postBody = `{ 'IR_PROTOCOL' : '${ir_protocol}', `+
        `'IR_CODE' : '${ir_code}' }`;

    outputDebugString(`[sendIRCode] Sending to: ${strURL}. Payload:\n`+
        `${postBody}`);

    try {
        let oReq = new XMLHttpRequest();

        oReq.onload = (e) => {
            let strOutput = oReq.responseText;
            outputDebugString(`[sendIRCode] Response Text:\n${strOutput}`);
            sendNextCode(); // Keep the pump going
        };

        oReq.open("POST", strURL, true);
        oReq.send(postBody);
    } catch (ex) {
        outputDebugString(`[sendIRCode] Failed ****\n${ex}`);
    }
}

/*
sendNextCode

Pulls the next command from the queue (if any left) then calls sendIRCode
with the protocol and code.

This function also handles the various special code protocols, like:

DELAY,<MS>
Sets a timeout to trigger sending IR_CODE <MS> from now.

DELAY_UNTIL_DATE_TIME,<FUTURE_DATE_TIME>
Parses <FUTURE_DATE_TIME>, calculates difference between then and now in ms
and sets a timeout to trigger for that calculated delay.

...if there's a falure during these 'special' codes, the default behavior is
to clear the queue, as something is definitely going wrong and likely means
badly formatted input.

NOTE: Since the DELAY* behaviors are currently implemented client side,
the page needs to remain open for duration until <FUTURE_DATE_TIME>.

Maybe in the future the queue will be implemented on the device and handled
there.  For now it's simpler to experiment with everything client side.
*/
function sendNextCode() {
    let next_code = g_IRCodeQueue.shift();

    // Bail if nothing in the queue.
    if (!next_code) {
        outputDebugString(`[sendNextCode] Queue empty. Nothing to send`);
        return;
    }

    // Pivot on PROTOCOL vs. Special Code...
    if (next_code.IR_PROTOCOL == `DELAY`) {
        let delayms = parseInt(next_code.IR_CODE);
        outputDebugString(`[sendNextCode] Delaying ${delayms}ms`);
        setTimeout(sendNextCode, delayms);
    } else if (next_code.IR_PROTOCOL == `DELAY_UNTIL_DATE_TIME`) {
        let delayUntilDate;
        let delayms = 0;
        let irCodeAsDate = next_code.IR_CODE.replace(/"/gi,'');

        // Try to parse the value, bail and clear queue if bad format.
        try {
            delayUntilDate = Date.parse(`${irCodeAsDate}`)
        } catch (ex) {
            outputDebugString(`[sendNextCode] **** Failed to parse ` +
                `DELAY_UNTIL_DATE_TIME of ${next_code.IR_CODE}`);
            g_IRCodeQueue = new Array(); // clear on error
            return;
        }

        // Calculate delay time.  If DELAY_UNTIL_DATE_TIME already passed, then
        // just cause the next code to be sent.
        let dateNow = new Date();
        if (delayUntilDate <= dateNow) {
            outputDebugString(`[sendNextCode] DELAY_UNTIL_DATE_TIME ` +
                `${next_code.IR_CODE} already passed. No Delay added.`);
            sendNextCode();
        } else {
            // Calculate the delay time in ms and call setTimeout to schedule
            // trigger.
            delayms = Math.ceil(
                (delayUntilDate.valueOf() - dateNow.valueOf()));
            outputDebugString(`[sendNextCode] Delaying ${delayms}ms`);
            setTimeout(sendNextCode, delayms);
        }

    // Normal IR_PROTOCOL / IR_CODE combo. Send away.
    } else {
        outputDebugString(`[sendNextCode] IR_PROTOCOL: `+
        `${next_code.IR_PROTOCOL}, IR_CODE: ${next_code.IR_CODE}`);
        sendIRCode(next_code.IR_PROTOCOL, next_code.IR_CODE);
    }
}

/*
enqueueIRCode

Helper function to add protocol/IR_CODE pair to the global IR Code queue, with
simple validation.
*/
function enqueueIRCode(ir_protocol, ir_code) {
    // Simple validation...
    if (!ir_protocol || !ir_code ||
         ir_protocol?.length <= 0 || ir_code?.length <= 0) {
        outputDebugString(`[enqueueIRCode] Unable to enqueue ir protocol: \"` +
        `${ir_protocol}\", IR Code: \"${ir_code}\"`);
    }

    g_IRCodeQueue.push(
        {
            'IR_PROTOCOL' : `${ir_protocol}`,
            'IR_CODE'     : `${ir_code}`
        }
    );
}


/*
performAction

Function that handles performing the action given the provided ID.

Searches the global list of g_ActionsList list for the given Action ID.

g_Actionlist associates a list of Commands.
Commands have a list of IDs of g_IRCodes entries.
g_IRCodes entries contain one or more IRCode and Protocol pairs.


If found, it then iterates over the commands for the given action, and for
each command, it grabs its list of IR codes (mostly just 1 IR code, but as
noted below, some remotes emit 2 codes for a given button press).  These
IR Codes are then added to the IRCodeQueue
*/
function performAction(action_id) {
    // Get the action for the given Action ID
    let action = g_ActionsList.find( (e) => {
        return (e.ACTION_ID === `${action_id}`)
    });

    // If Action found, iterate through the commands list, for all commands
    // found, find its corresponding IR Code, and add to the global IR Code
    // queue.
    if (action && action.COMMAND_LIST.length > 0) {

        // Iterate across list of commands
        action.COMMAND_LIST.forEach( (command) => {
            let ir_code = g_IRCodes.find( (ir) => {
                return (ir.IR_COMMAND_ID === `${command}`);
            });

            // Lookup IR PROTOCOL and CODE for given command
            // XFinity XR2 remote emits 2 codes for some buttons, so IR_CODE is
            // treated as an array and also needs to be iterated over.
            // Push all commands found into the global IRCodeQueue.
            if (ir_code && ir_code.IR_CODE.length > 0) {
                ir_code.IR_CODE.forEach( (code) => {
                    enqueueIRCode(ir_code.IR_PROTOCOL, code);
                })
            }
        });

        outputDebugString(`[performAction] Commands for action ${action_id}: ` +
            `${action?.COMMAND_LIST.join(', ')}`);

    // Didn't find the given Action, output error message.
    } else {
        outputDebugString(`[performAction] **** Unable to find action for id:` +
            ` ${action_id}.  Make sure HTML and global action list line up.`);
    }

    // Even if we didn't find the right action, keep the pump going.
    sendNextCode();
}

/*
OnControlButtonClick

Click handler for all Remote Control and Preset buttons.

Pulls the ActionID from the data-action attribute and sends to performAction()
*/
function OnControlButtonClick(btn){
    let action_id = btn.getAttribute('data-action');
    if (action_id) {
        outputDebugString(`[OnControlButtonClick] Button Clicked ID: ${btn.id}`+
            `Action: ${action_id} `);
        performAction(action_id);
    } else {
        outputDebugString(`[OnControlButtonClick] **** Unable to find action ` +
            `for button.id:${btn.id}`);
    }
}


/*
hideElement

Helper function for ShowNavSectionWithID, to hide the given element.
*/
function hideElement(element) {
    element.style.display    = 'none';
    element.style.visibility = 'hidden';
}


/*
showElement

Helper function for ShowNavSectionWithID, to show the given element.
*/
function showElement(element) {
    element.style.display    = '';
    element.style.visibility = 'visible';
}

/*
ShowNavSectionWithID

Crude peek-a-boo-swapper-roo approach to hide/show sections based on the section
id passed in.
*/
function ShowNavSectionWithID(sectionId) {
    let ids = [ "divDefaultButtons",
                "divComcastButtons",
                "divXFinityXR2Buttons",
                "divVizioButtons",
                "divPresetsButtons",
                "divRawValues"];

    ids.forEach( (e) => {
        let div = document.querySelector(`#${e}`);
        if (div) {
            if (div.id == sectionId){
                showElement(div);
            } else {
                hideElement(div)
            }
        }
    });
}

/*
onClickNavButton

Click() handler for the main nav buttons. data-nav-id attribute of the
BUTTON passed through to ShowNavSectionWithID() to cause appropriate section
to be shown.
*/
function onClickNavButton(btn) {
    let navId = btn.getAttribute('data-nav-id');
    if (navId) {
        ShowNavSectionWithID(navId);
    }
}

/*
clearRawValues

Function to simply clear the raw values list.
*/
function clearRawValues() {
    let oRawValues = document.querySelector(`#txtRawIRValues`);
    if (oRawValues) {
        oRawValues.value = "";
    }
}

/*
sendRawValues

Function that gathers list of values from the Raw Values text area and adds them
to the IR queue.

Lines need to be formatted as one of the following:

<CODE>,<VALUE>
In most cases, the CODE will be the protocol (NEC, XMP, etc.)
And the VALUE will be the IR code (0x20DF10EF, 0x170F443E1E000100, etc.)

DELAY,<DELAY_IN_MS>
Delay sending the command that follows this one, by <DELAY_IN_MS>.

DELAY_UNTIL_DATE_TIME,<DATE_TIME>
Delay sending the command that follows thsi one, until <DATE_TIME> reached.

Text after "#" is ignored, to support commenting.

Example:
# Send VIZIO [Power], Comcast [1] [1] [9] [7] [ENTER]....
DELAY_UNTIL_DATE_TIME,"1/7/2025 3:00:00 AM"
NEC,0x20DF10EF # Turn on the TV
XMP,0x170F443E1E000100 # Button 1
XMP,0x170F443E1E000100 # Button 1
XMP,0x170F443E16000900 # Button 9
XMP,0x170F443E18000700 # Button 7
XMP,0x170F443E18002500 # Button ENTER
DELAY,5000
XMP,0x170F443E1B000400 # Button 4
XMP,0x170F443E17000800 # Button 8
XMP,0x170F443E18002500 # Button ENTER
DELAY,5000
XMP,0x170F443E1B000400 # Button 4
XMP,0x170F443E18002500 # Button ENTER

First line is ignored, because it starts with "#", and servers as a oen line
comment.

    DELAY_UNTIL_DATE_TIME,"1/7/2025 3:00:00 AM"
...means delay running the next line:
    NEC,0x20DF10EF # Turn on the TV
...until 3a (iow, turn the TV on at 3a)

The XMP commands are added to the queue right after that, until the line:
    DELAY,5000
...is reached, and will cause a 5 second delay, until the next set of XMP
commands are added to the queue.

And finally, after that set is queued the next line
    DELAY,5000
...causes another 5 second delay, and then the last 2 commands are queued.

Since the queue is constantly being tickled via sendNextCode(), the delays
end up being very accurate in how the actual resulting TV and Cable box are
controlled.

*/
function sendRawValues() {
    let oRawValues = document.querySelector(`#txtRawIRValues`);
    if (!oRawValues) {
        outputDebugString(`[sendRawValues] Unable to find text area`);
        return;
    }

    if (oRawValues.value.length <= 0) {
        outputDebugString(`[sendRawValues] Nothing to do.`);
        return;
    }

    let aAllLines = oRawValues.value.split('\n');

    // Go through each line, grabbing those closest to <CODE>,<VALUE> format
    let aLines = [];
    aAllLines.forEach( (line) => {
        // If line contains a "#" grab whatever is before it.  This handles
        // line that start with or have "#" somewhere within.
        if (line.match(/#/gi)) {
            let indexOfHash = line.indexOf(`#`);
            if (indexOfHash > 0) {
                let newLine = (line.substr(0, indexOfHash)).trim();
                if (newLine && newLine.length > 0) {
                    aLines.push( newLine);
                }
            }
        } else if (line.length > 0) {
            aLines.push( line.trim() );
        }
    });

    // Create the array of KVPs as { CODE: <code>, VALUE: <value> }
    let aCodeAndValuesList = [];
    aLines.forEach( (line) => {
        let rxKVP = new RegExp(`(?<CODE>.*?),(?<VALUE>.*)`,`gi`);
        let m = rxKVP.exec(line);
        if (m) {
            aCodeAndValuesList.push( 
                { 
                    'CODE'  : m.groups['CODE'],
                    'VALUE' : m.groups['VALUE']
                }
            );
        }
    });

    // At this point, we have an array of objects with CODE/VALUE fields, ready
    // to be enqueued.
    aCodeAndValuesList.forEach( (e) => {
        enqueueIRCode(e.CODE, e.VALUE);
    });

    // For Debugging...
    outputDebugString(`IR Code Queue Entries [${g_IRCodeQueue.length}]`);
    g_IRCodeQueue.forEach( (e) => {
        outputDebugString(`${JSON.stringify(e)}`);
    });

    // Start the pump.
    sendNextCode();
}


/*
initRawValuesWithTestValues

Used during development of the raw values feature, this function handles
adding test data to the raw values textarea.

It also calculates a DELAY_UNTIL_DATE_TIME of 10 seconds from 'now', which is
when the page loads, so refreshing the page sets everything up for a valid
sequence (for at least 10 seconds :o)
*/
function initRawValuesWithTestValues() {
    let oRawValues = document.querySelector(`#txtRawIRValues`);
    if (oRawValues) {
        let dtNow = new Date();
        dtNow.setSeconds( dtNow.getSeconds() + 10);
        oRawValues.value +=`# Send VIZIO [Power], Comcast [1] [1] [9] [7] `+
            `[ENTER]\n`;
        oRawValues.value +=`DELAY_UNTIL_DATE_TIME,`+
            `"${dtNow.toLocaleDateString()} ${dtNow.toLocaleTimeString()}"\n`;
        oRawValues.value +=`NEC,0x20DF10EF\n`;
        oRawValues.value +=`XMP,0x170F443E1E000100 # Button 1\n`;
        oRawValues.value +=`XMP,0x170F443E1E000100 # Button 1\n`;
        oRawValues.value +=`XMP,0x170F443E16000900 # Button 9\n`;
        oRawValues.value +=`XMP,0x170F443E18000700 # Button 7\n`;
        oRawValues.value +=`XMP,0x170F443E18002500 # Button ENTER\n`;
        oRawValues.value +=`DELAY,5000\n`;
        oRawValues.value +=`XMP,0x170F443E1B000400 # Button 2\n`;
        oRawValues.value +=`XMP,0x170F443E17000800 # Button 8\n`;
        oRawValues.value +=`XMP,0x170F443E18002500 # Button ENTER\n`;
        oRawValues.value +=`DELAY,5000\n`;
        oRawValues.value +=`XMP,0x170F443E1B000400 # Button 4\n`;
        oRawValues.value +=`XMP,0x170F443E18002500 # Button ENTER\n`;
    }
}


/*
outputStringToUI

Quick way to spew text to the UI. Mostly useful during dev/debugging.
*/
function outputStringToUI(str) {
    let oOutput = document.getElementById('txtOutput');
    if (!oOutput) {
        return;
    }
    oOutput.innerText = `${str}\n${oOutput.innerText}`;
}

/*
processQueryParameters

Check the URL for key directives indicating which 'tab' (section) to display.

A param of "host_ip" is supported, to allow overriding the location.host value
if being loaded from the device.

If file is loaded locally without the host_ip param, then page doesn't do
anything.
*/
function processQueryParameters() {
    let params = location.search.split('&');

    params.forEach( (param) => {
        if (param.match(/comcast/gi)) {
            ShowNavSectionWithID('divComcastButtons');
        } else if (param.match(/xfinity/gi)) {
            ShowNavSectionWithID('divXFinityXR2Buttons');
        } else if (param.match(/vizio/gi)) {
            ShowNavSectionWithID('divVizioButtons');
        } else if (param.match(/presets/gi)) {
            ShowNavSectionWithID('divPresetsButtons');
        } else if (param.match(/rawvalues/gi)) {
            ShowNavSectionWithID('divRawValues');
        } else {
            ShowNavSectionWithID('divDefaultButtons');
        }

        // RX for grabbing nnn.nnn.nnn.nnn:pppp from URL if present.  Port is
        // optional.  Mostly used for dev/debugging.
        let rxHostIP =
            RegExp('(?<IP_ADDRESS>\\d{1,3}.\\d{1,3}.\\d{1,3}.\\d{1,3}'+
                '(:\\d{1,4}){0,1})','gi');

        let hostIPMatch = rxHostIP.exec(param);

        if (hostIPMatch && hostIPMatch.groups &&
            hostIPMatch.groups['IP_ADDRESS']) {
            g_HostIP = decodeURIComponent(hostIPMatch.groups['IP_ADDRESS']);
        }
    });

    // If host_ip not present in the URL try location.host
    // If location.host not defined (ex. page loaded via File:///), leave
    // undefined, for later code logic to handle (fails and bails)
    if (!g_HostIP && location.host) {
        g_HostIP = location.host;
    }
}

/*
outputDebugString

Simple wrapper for outputting string to the console.

NOTE:
When using MinifyAll VSCode extension: https://github.com/Josee9988/MinifyAll
Need to set MinifyAll.terserMinifyOptions.compress,  "drop_console": false
...otherwise, the console.log calls are removed and you get no output, which
may or maynot be what you expect, so including this NOTE here as FYI.
*/
function outputDebugString(str) {
    let dtNow  = new Date();
    let prefix = `${dtNow.toLocaleDateString()} ${dtNow.toLocaleTimeString()}`;
    console.log(`[${prefix}] ${str}`);
}

function DoOnContentLoaded() {
    processQueryParameters();
    initRawValuesWithTestValues(); // For dev/testing.
}

window.addEventListener('DOMContentLoaded', () => {
    DoOnContentLoaded();
});

/*
g_ActionsList

This list maps the action for a given html BUTTON, to a list of commands.

<button> elements representing just remote control buttons will usually be
mapped to just 1 command (the IR code).

<button> elements representing Presets will usually have 2 or more commands
listed, representing a sequence of button presses on the remote control.

New buttons will need an entry in this list and wired up to new IR codes in
the global IRCodes list.

See performAction() for how this list is used.
*/
let g_ActionsList = [
    /* Smaller Comcast Remote control */
    {'ACTION_ID':'ACTION_COMCAST_0','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_0']},
    {'ACTION_ID':'ACTION_COMCAST_1','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_1']},
    {'ACTION_ID':'ACTION_COMCAST_2','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_2']},
    {'ACTION_ID':'ACTION_COMCAST_3','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_3']},
    {'ACTION_ID':'ACTION_COMCAST_4','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_4']},
    {'ACTION_ID':'ACTION_COMCAST_5','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_5']},
    {'ACTION_ID':'ACTION_COMCAST_6','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_6']},
    {'ACTION_ID':'ACTION_COMCAST_7','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_7']},
    {'ACTION_ID':'ACTION_COMCAST_8','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_8']},
    {'ACTION_ID':'ACTION_COMCAST_9','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_9']},
    {'ACTION_ID':'ACTION_COMCAST_CHANNEL_DOWN','COMMAND_LIST':['COMCAST_REMOTE_BUTTON_CHANNEL_DOWN']},
    {'ACTION_ID':'ACTION_COMCAST_CHANNEL_UP','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_CHANNEL_UP']},
    {'ACTION_ID':'ACTION_COMCAST_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_DOWN']},
    {'ACTION_ID':'ACTION_COMCAST_ENTER','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_ENTER']},
    {'ACTION_ID':'ACTION_COMCAST_EXIT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_EXIT']},
    {'ACTION_ID':'ACTION_COMCAST_INFO','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_INFO']},
    {'ACTION_ID':'ACTION_COMCAST_LANG','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_LANG']},
    {'ACTION_ID':'ACTION_COMCAST_LAST','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_LAST']},
    {'ACTION_ID':'ACTION_COMCAST_LEFT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_LEFT']},
    {'ACTION_ID':'ACTION_COMCAST_OK','COMMAND_LIST': ['COMCAST_REMOTE_BUTTON_ENTER']},
    {'ACTION_ID':'ACTION_COMCAST_PAGE_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PAGE_DOWN']},
    {'ACTION_ID':'ACTION_COMCAST_PAGE_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PAGE_UP']},
    {'ACTION_ID':'ACTION_COMCAST_RIGHT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_RIGHT']},
    {'ACTION_ID':'ACTION_COMCAST_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_UP']},

    /* Presets */
    {'ACTION_ID':'ACTION_PRESET_MUSIC_903','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_0', 'XFINITYXR2_REMOTE_BUTTON_3','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_904','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_0', 'XFINITYXR2_REMOTE_BUTTON_4','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_913','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_3','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_918','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_8','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_928','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_8','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_929','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_9','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_930','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_0','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_934','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_4','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_943','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_4', 'XFINITYXR2_REMOTE_BUTTON_3','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_948','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_4', 'XFINITYXR2_REMOTE_BUTTON_8','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_MUSIC_949','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_4', 'XFINITYXR2_REMOTE_BUTTON_9','XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_BCTV','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_8', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_CREATE','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_6', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_DISC','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_8', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_ESPN1','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_ESPN2','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_AANDE','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_5', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_BBC','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_5', 'XFINITYXR2_REMOTE_BUTTON_0', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KCPQ','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KCTS','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KING','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_5', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KIRO','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_7', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KOMO','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_4', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KOMO2','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_3', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_8', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KONG','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_6', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KZJO','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_0', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KSTW','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_KBTC','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_2', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_METV','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_5', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_FMC','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_0', 'XFINITYXR2_REMOTE_BUTTON_7', 'XFINITYXR2_REMOTE_BUTTON_8', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_METV_PLUS','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_6', 'XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_PRESET_TV_HEROES_AND_ICONS','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_1', 'XFINITYXR2_REMOTE_BUTTON_9', 'XFINITYXR2_REMOTE_BUTTON_7', 'XFINITYXR2_REMOTE_BUTTON_OK']},

    /* Vizio TV Remote Control */
    {'ACTION_ID':'ACTION_VIZIO_0','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_0']},
    {'ACTION_ID':'ACTION_VIZIO_1','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_1']},
    {'ACTION_ID':'ACTION_VIZIO_2','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_2']},
    {'ACTION_ID':'ACTION_VIZIO_3','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_3']},
    {'ACTION_ID':'ACTION_VIZIO_4','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_4']},
    {'ACTION_ID':'ACTION_VIZIO_5','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_5']},
    {'ACTION_ID':'ACTION_VIZIO_6','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_6']},
    {'ACTION_ID':'ACTION_VIZIO_7','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_7']},
    {'ACTION_ID':'ACTION_VIZIO_8','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_8']},
    {'ACTION_ID':'ACTION_VIZIO_9','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_9']},
    {'ACTION_ID':'ACTION_VIZIO_BUTTON_V','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_V']},
    {'ACTION_ID':'ACTION_VIZIO_CHANNEL_DOWN','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_CHANNEL_DOWN']},
    {'ACTION_ID':'ACTION_VIZIO_CHANNEL_UP','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_CHANNEL_UP']},
    {'ACTION_ID':'ACTION_VIZIO_DASH','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_DASH']},
    {'ACTION_ID':'ACTION_VIZIO_FREEZE','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_FREEZE']},
    {'ACTION_ID':'ACTION_VIZIO_GUIDE','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_GUIDE']},
    {'ACTION_ID':'ACTION_VIZIO_INPUT','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_INPUT']},
    {'ACTION_ID':'ACTION_VIZIO_LAST','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_LAST']},
    {'ACTION_ID':'ACTION_VIZIO_MUTE','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_MUTE']},
    {'ACTION_ID':'ACTION_VIZIO_PIP','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_PIP']},
    {'ACTION_ID':'ACTION_VIZIO_POWER','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_POWER']},
    {'ACTION_ID':'ACTION_VIZIO_SOURCE_AV','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_AV']},
    {'ACTION_ID':'ACTION_VIZIO_SOURCE_COMP','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_COMP']},
    {'ACTION_ID':'ACTION_VIZIO_SOURCE_HDMI','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_HDMI']},
    {'ACTION_ID':'ACTION_VIZIO_SOURCE_TV','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_TV']},
    {'ACTION_ID':'ACTION_VIZIO_SWAP_SRC','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_SWAP']},
    {'ACTION_ID':'ACTION_VIZIO_VOLUME_DOWN','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_VOLUME_DOWN']},
    {'ACTION_ID':'ACTION_VIZIO_VOLUME_UP','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_VOLUME_UP']},

    /* Larger Xfinity Comcast (XR2) Remote Control */
    {'ACTION_ID':'ACTION_XFINITYXR2_1','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_1']},
    {'ACTION_ID':'ACTION_XFINITYXR2_2','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_2']},
    {'ACTION_ID':'ACTION_XFINITYXR2_3','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_3']},
    {'ACTION_ID':'ACTION_XFINITYXR2_4','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_4']},
    {'ACTION_ID':'ACTION_XFINITYXR2_5','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_5']},
    {'ACTION_ID':'ACTION_XFINITYXR2_6','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_6']},
    {'ACTION_ID':'ACTION_XFINITYXR2_7','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_7']},
    {'ACTION_ID':'ACTION_XFINITYXR2_8','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_8']},
    {'ACTION_ID':'ACTION_XFINITYXR2_9','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_9']},
    {'ACTION_ID':'ACTION_XFINITYXR2_A','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_A']},
    {'ACTION_ID':'ACTION_XFINITYXR2_ALL_POWER','COMMAND_LIST': ['VIZIO_REMOTE_BUTTON_POWER', 'XFINITYXR2_REMOTE_BUTTON_ALL_POWER']},
    {'ACTION_ID':'ACTION_XFINITYXR2_ARROW_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_DOWN']},
    {'ACTION_ID':'ACTION_XFINITYXR2_ARROW_LEFT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_LEFT']},
    {'ACTION_ID':'ACTION_XFINITYXR2_ARROW_RIGHT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_RIGHT']},
    {'ACTION_ID':'ACTION_XFINITYXR2_ARROW_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_ARROW_UP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_B','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_B']},
    {'ACTION_ID':'ACTION_XFINITYXR2_BUTTON_0','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_0']},
    {'ACTION_ID':'ACTION_XFINITYXR2_C','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_C']},
    {'ACTION_ID':'ACTION_XFINITYXR2_CHANNEL_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_CHANNEL_DOWN']},
    {'ACTION_ID':'ACTION_XFINITYXR2_CHANNEL_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_CHANNEL_UP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_D','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_D']},
    {'ACTION_ID':'ACTION_XFINITYXR2_EXIT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_EXIT']},
    {'ACTION_ID':'ACTION_XFINITYXR2_FAV','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_FAV']},
    {'ACTION_ID':'ACTION_XFINITYXR2_FF','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_FF']},
    {'ACTION_ID':'ACTION_XFINITYXR2_GUIDE','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_GUIDE']},
    {'ACTION_ID':'ACTION_XFINITYXR2_INFO','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_INFO']},
    {'ACTION_ID':'ACTION_XFINITYXR2_LAST','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_LAST']},
    {'ACTION_ID':'ACTION_XFINITYXR2_MUTE','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_MUTE']},
    {'ACTION_ID':'ACTION_XFINITYXR2_OK','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_OK']},
    {'ACTION_ID':'ACTION_XFINITYXR2_PAGE_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PAGE_DOWN']},
    {'ACTION_ID':'ACTION_XFINITYXR2_PAGE_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PAGE_UP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_PAUSE','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PAUSE']},
    {'ACTION_ID':'ACTION_XFINITYXR2_PLAY','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_PLAY']},
    {'ACTION_ID':'ACTION_XFINITYXR2_TV_POWER','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_TV_POWER', 'VIZIO_REMOTE_BUTTON_POWER']},
    {'ACTION_ID':'ACTION_XFINITYXR2_REC','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_REC']},
    {'ACTION_ID':'ACTION_XFINITYXR2_REWIND','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_REWIND']},
    {'ACTION_ID':'ACTION_XFINITYXR2_SEARCH','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_SEARCH']},
    {'ACTION_ID':'ACTION_XFINITYXR2_STOP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_STOP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_SWAP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_SWAP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_TV_INPUT','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_TV_INPUT']},
    {'ACTION_ID':'ACTION_XFINITYXR2_VOL_DOWN','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_VOL_DOWN']},
    {'ACTION_ID':'ACTION_XFINITYXR2_VOL_UP','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_VOL_UP']},
    {'ACTION_ID':'ACTION_XFINITYXR2_XFINITY_MENU','COMMAND_LIST': ['XFINITYXR2_REMOTE_BUTTON_XFINITY_MENU']},
];

/*
g_IRCodes

This list provides a mapping of the given Command ID and IR code(s) it
represents.

In most cases, there's just one code, but some remote controls emit multiple.

[Note about remote controls programmed for specific TVs]
Many remotes like the Comcast digital adapter remote or XFinity XR2 can be
programmed for a given TV, which means that when buttons like Volume Up/Down,
Power, Mute, etc. are pressed, the remote will actually emit the IR code for the
TV.

To make this UI work, the HTML buttons for Volume Up/Down, Power, etc. have
their data-action attribute set to whatever the expected TV is. I've found that
there are some exceptions, where the Remote control will emit both an NEC (for
the Vizio TV) and an XMP code for whatever its native operation is.

In the case of my setup, in some places the BUTTON elements for the remote
are set to a VIZIO action ID, in others, there are multiple.  Kind of confusing
but I guess just part of the tax of having multiple remotes and devices.

Example:
The "Volume +" button on the "Main" section of the page is the following:
<button
    class="default-control-button-style"
    id="btnMainVizioVolumeUp"
    onClick="OnControlButtonClick(this);"
    data-action="ACTION_VIZIO_VOLUME_UP">Volume +</button>

Here, the data-action attribute is set to ACTION_VIZIO_VOLUME_UP, which is this
entry in g_ActionsList:

    {
        'ACTION_ID'    : 'ACTION_VIZIO_VOLUME_UP',
        'COMMAND_LIST' : ['VIZIO_REMOTE_BUTTON_VOLUME_UP']
    },

and VIZIO_REMOTE_BUTTON_VOLUME_UP maps to

    {
        'IR_COMMAND_ID' : 'VIZIO_REMOTE_BUTTON_VOLUME_UP',
        'IR_PROTOCOL'   : 'NEC',
        'IR_CODE'       : ['0x20DF12ED']
    },

...in the g_IRCodes list.

Also note, the Comcast and XFinity XR2 remotes emit what looks like a NOP type
of XMP code of 0x170F443E14008300, when mapped to a TV.  No need to send those,
just mentioning here as a bit of trivia :o)
*/

let g_IRCodes = [
    /* Comcast remote. These are the unmapped, factory default values */
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_POWER','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E10000F00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_INFO','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17002600']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_1','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1E000100']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_2','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1D000200']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_3','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1C000300']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_4','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1B000400']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_5','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1A000500']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_6','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19000600']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_7','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18000700']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_8','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17000800']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_9','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E16000900']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_0','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1F000000']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_ENTER','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18002500']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_LAST','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19005100']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_VOLUME_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E15000A00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_VOLUME_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E14000B00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_CHANNEL_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E12000D00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_CHANNEL_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E11000E00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_MUTE','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E13000C00']},
    {'IR_COMMAND_ID':'COMCAST_REMOTE_BUTTON_LANG','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E15008200']},

    /* VIZIO TV remote */
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_0','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF08F7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_1','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF8877']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_2','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF48B7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_3','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFC837']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_4','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF28D7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_5','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFA857']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_6','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF6897']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_7','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFE817']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_8','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF18E7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_9','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF9867']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_AV','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF8A75']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_V','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFC23D']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_CHANNEL_DOWN','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF629D']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_CHANNEL_UP','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFA25D']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_COMP','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF5AA5']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_DASH(-)','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFFF00']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_FREEZE','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFA659']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_GUIDE','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF38C7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_HDMI','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF639C']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_INPUT','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFF40B']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_LAST','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF58A7']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_MUTE','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF906F']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_PIP','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF06F9']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_POWER','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF10EF']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_SWAP','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF6699']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_TV','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF6B94']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_VOLUME_DOWN','IR_PROTOCOL':'NEC','IR_CODE':['0x20DFE21D']},
    {'IR_COMMAND_ID':'VIZIO_REMOTE_BUTTON_VOLUME_UP','IR_PROTOCOL':'NEC','IR_CODE':['0x20DF12ED']},

    /* XFinity XR2 remote. These are the unmapped, factory default values */
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_TV_POWER','IR_PROTOCOL':'XMP','IR_CODE': ['0x170F443E16009000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_ALL_POWER','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E10000F00', '0x170F443E1100E000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_TV_INPUT','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E13005700']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_VOL_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E15000A00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_VOL_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E14000B00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_MUTE','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E13000C00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_SEARCH','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1400CF00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_CHANNEL_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E12000D00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_CHANNEL_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E11000E00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_REWIND','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19003300']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_PLAY','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1C003000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_PAUSE','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1A003200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_FF','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18003400']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_STOP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1B003100']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_XFINITY_MENU','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1D002000', '0x170F443E1100E000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_REC','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17003500']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_GUIDE','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E16002700', '0x170F443E1100E000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_PAGE_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E15002800']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_PAGE_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E14002900']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_ARROW_UP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1C002100']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_ARROW_DOWN','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1B002200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_ARROW_LEFT','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1A002300']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_ARROW_RIGHT','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19002400']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_OK','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18002500']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_LAST','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19005100']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_EXIT','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E13002A00']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_INFO','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17002600']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_FAV','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18005200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_A','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19006000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_B','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18006100']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_C','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17006200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_D','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E15008200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_1','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1E000100']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_2','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1D000200']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_3','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1C000300']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_4','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1B000400']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_5','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1A000500']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_6','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E19000600']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_7','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E18000700']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_8','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E17000800']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_9','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E16000900']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_0','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E1F000000']},
    {'IR_COMMAND_ID':'XFINITYXR2_REMOTE_BUTTON_SWAP','IR_PROTOCOL':'XMP','IR_CODE':['0x170F443E11005900']}
];
