const enum ZoomConnectionStatus {
  //% block="None"
  NONE = 0,
  //% block="ESP device"
  ESP = 1,
  //% block="WiFi network"
  WIFI = 2,
  //% block="internet"
  INTERNET = 3,
  //% block="meeting room"
  MEETING = 4,
}

const enum TimeZone {
  //% block="UTC"
  UTC,
  //% block="America Los Angeles"
  America_Los_Angeles,
  //% block="Europe Berlin"
  Europe_Berlin,
  America_New_York,
  Asia_Tokyo
}

/**
  * Turns a time zone id into a string that describes the timezone.
  */
//% blockId=makerbit_helper_timezone
//% block="%timezone"
//% blockHidden=true
function timezone(timezone: TimeZone): string {
  // https://github.com/esp8266/Arduino/blob/master/cores/esp8266/TZ.h
  switch (timezone) {
    case TimeZone.America_Los_Angeles: return "PST8PDT,M3.2.0,M11.1.0";
    case TimeZone.Europe_Berlin: return "CET-1CEST,M3.5.0,M10.5.0/3";
    case TimeZone.America_New_York: return "TZ_America_New_York";
    case TimeZone.Asia_Tokyo: return "JST-9";
    default:
      return "UTC0";
  }
}


//% color=#0fbc11 icon="\u272a" block="MakerBit"
//% category="MakerBit"
namespace makerbit {
  export namespace zoom {
    interface Clock {
      time: string;
      date: string;
      lastTimeUpdate: number;
    }

    interface EspState {
      subscriptions: Subscription[];
      lastError: number;
      meeting: string;
      room: string;
      connectionStatus: number;
      notifiedConnectionStatus: number;
      device: string;
      espRX: DigitalPin;
      espTX: DigitalPin;
      ssid: string;
      wiFiPassword: string;
      obtainDeviceJobId: number;
      obtainConnectionStatusJobId: number;
      transmissionControl: boolean;
      clock: Clock;
    }

    export namespace tz {
      // https://github.com/esp8266/Arduino/blob/master/cores/esp8266/TZ.h
      export const Europe_Berlin = "CET-1CEST,M3.5.0,M10.5.0/3";
      export const America_Los_Angeles = "PST8PDT,M3.2.0,M11.1.0";
      export const America_New_York = "TZ_America_New_York";
      export const Asia_Tokyo = "JST-9";
      export const UTC = "UTC0"; // Universal Time Coordinated
    }

    const STRING_TOPIC = "s_";
    const NUMBER_TOPIC = "n_";
    const LED_TOPIC = "l_";
    const CONNECTION_TOPIC = "$ESP/connection";
    const DEVICE_TOPIC = "$ESP/device";
    const ERROR_TOPIC = "$ESP/error";
    const TIME_TOPIC = "$ESP/time";
    const DATE_TOPIC = "$ESP/date";
    const TRANSMISSION_CONTROL_TOPIC = "$ESP/tc";

    let espState: EspState = undefined;

    let serialWriteString = (text: string) => {
      serial.writeStringBlocking(text);
    };

    function normalize(value: string): string {
      if (!value) {
        return "";
      }
      return value.replaceAll(" ", "");
    }

    function publish(name: string, value: string): void {
      const msg = ["pub ", normalize(name), ' "', "" + value, '"\n'].join("");
      serialWriteString(msg);
    }

    function subscribe(topic: string): void {
      const msg = ["sub ", topic, '"\n'].join("");
      serialWriteString(msg);
    }

    class Subscription {
      topic: string;
      value: string;
      handler: (value: string | number | Image) => void;

      constructor(
        topic: string,
        handler: (value: string | number | Image) => void
      ) {
        this.value = "";
        this.topic = topic;
        this.handler = handler;
      }

      setValue(value: string) {
        this.value = value;
      }

      notifyUpdate() {
        if (!this.value.isEmpty()) {
          let decodedValue: string | number | Image = this.value;

          if (this.topic == LED_TOPIC) {
            decodedValue = decodeImage(parseInt(this.value));
          }

          this.value = "";
          this.handler(decodedValue);
        }
      }
    }

    function notifySubscriptionUpdates(): void {
      espState.subscriptions.forEach((subscription) => {
        subscription.notifyUpdate();
      });
    }

    function getFirstToken(data: string): string {
      const spaceIdx = data.indexOf(" ");

      if (spaceIdx < 0) {
        return data;
      } else {
        return data.substr(0, spaceIdx);
      }
    }

    function applyTopicUpdate(topic: string, value: string): boolean {
      let isExpectedTopic = false;

      if (topic.indexOf("$ESP/") === 0) {
        isExpectedTopic = true;

        if (topic === CONNECTION_TOPIC) {
          espState.connectionStatus = parseInt(getFirstToken(value));
        } else if (topic === ERROR_TOPIC) {
          espState.lastError = parseInt(getFirstToken(value));
        } else if (topic === DEVICE_TOPIC) {
          espState.device = getFirstToken(value);
        } else if (topic === TRANSMISSION_CONTROL_TOPIC) {
          espState.transmissionControl = value === "1";
        } else if (topic === TIME_TOPIC || topic === DATE_TOPIC) {
          if (!espState.clock) {
            espState.clock = {
              time: "00:00:00",
              date: "0000-00-00",
              lastTimeUpdate: 0,
            };
          }
          if (topic === TIME_TOPIC) {
            espState.clock.time = value;
            espState.clock.lastTimeUpdate = control.millis();
          } else {
            espState.clock.date = value;
          }
        }
      }

      espState.subscriptions.forEach((subscription) => {
        if (topic === subscription.topic) {
          isExpectedTopic = true;
          subscription.setValue(value);
        }
      });

      return isExpectedTopic;
    }

    function splitSerialMessage(
      message: string,
      removeTransmissionIdFromContent: boolean
    ): string[] {
      const contentIdx = message.indexOf(" ");
      const idIdx = message.indexOf(" ", message.length - 4);

      if (contentIdx < 0) {
        return [message, "", "0"];
      }

      const hasId = idIdx > 0 && idIdx > contentIdx;

      const data = [];

      // Add topic
      data.push(message.substr(0, contentIdx));

      // Add content
      if (hasId && removeTransmissionIdFromContent) {
        data.push(message.substr(contentIdx + 1, idIdx - contentIdx - 1));
      } else {
        data.push(
          message.substr(contentIdx + 1, message.length - contentIdx - 1)
        );
      }

      // Add transmission ID
      if (hasId) {
        data.push(message.substr(idIdx + 1, 3));
      } else {
        data.push("0");
      }

      return data;
    }

    function processSerialMessage(message: string): void {
      const data = splitSerialMessage(message, espState.transmissionControl);

      const isExpectedTopic = applyTopicUpdate(data[0], data[1]);

      if (isExpectedTopic && espState.transmissionControl) {
        const msg = ["ack ", data[2], "\n"].join("");
        serialWriteString(msg);
      }
    }

    function readSerialMessages(): void {
      let message: string = "";

      while (true) {
        while (serial.available() > 0) {
          const r = serial.read();
          if (r != -1) {
            if (r == Delimiters.NewLine) {
              processSerialMessage(message);
              message = "";
            } else {
              if (message.length < 64) {
                message = message.concat(String.fromCharCode(r));
              } else {
                message = "";
              }
            }
          }
        }
        basic.pause(5);
      }
    }

    /**
     * Registers code to run when the micro:bit receives a string.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_receive_string"
    //% block="on zoom received"
    //% draggableParameters=reporter
    //% weight=49
    //% blockHidden=true
    export function onReceivedString(
      handler: (receivedString: string) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(STRING_TOPIC, handler));
      subscribe(STRING_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a number.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_receive_number"
    //% block="on zoom received"
    //% draggableParameters=reporter
    //% weight=50
    //% blockHidden=true
    export function onReceivedNumber(
      handler: (receivedNumber: number) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(NUMBER_TOPIC, handler));
      subscribe(NUMBER_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a screenshot.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_receive_screenshot"
    //% block="on zoom received"
    //% draggableParameters=reporter
    //% weight=48
    export function onReceivedScreenshot(
      handler: (receivedScreenshot: Image) => void
    ): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(LED_TOPIC, handler));
      subscribe(LED_TOPIC);
    }

    /**
     * Do something when the micro:bit receives a number in a channel.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_receive_number_in_channel"
    //% block="on zoom received in channel %channel"
    //% draggableParameters=reporter
    //% weight=47
    export function onReceivedNumberInChannel(
      channel: string,
      handler: (receivedNumber: number) => void
    ): void {
      autoConnectToESP();
      const topic = NUMBER_TOPIC + normalize(channel);
      espState.subscriptions.push(new Subscription(topic, handler));
      subscribe(topic);
    }

    /**
     * Do something when the micro:bit receives a string in a channel.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_receive_string_in_channel"
    //% block="on zoom received in channel %channel"
    //% draggableParameters=reporter
    //% weight=46
    export function onReceivedStringInChannel(
      channel: string,
      handler: (receivedString: string) => void
    ): void {
      autoConnectToESP();
      const topic = STRING_TOPIC + normalize(channel);
      espState.subscriptions.push(new Subscription(topic, handler));
      subscribe(topic);
    }

    /**
     * Do something when the ESP notifies an error.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_error"
    //% block="on zoom error"
    //% weight=29
    export function onError(handler: () => void): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(ERROR_TOPIC, handler));
    }

    /**
     * Do something when the connection status changes.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_on_connection_status"
    //% block="on zoom connection status"
    //% weight=30
    export function onConnectionStatus(handler: () => void): void {
      autoConnectToESP();
      espState.subscriptions.push(new Subscription(CONNECTION_TOPIC, handler));
    }

    function getDate(timezone: string): void {
      autoConnectToESP();
      const msg = ["date ", timezone, "\n"].join("");
      serialWriteString(msg);
    }

    function refreshTimeNetwork(timezone: string): void {
      autoConnectToESP();
      const msg = ["time ", timezone, "\n"].join("");
      serialWriteString(msg);
    }

    function toSeconds(timeString: string): number {
      const time = timeString.split(":");
      return (
        parseInt(time[0]) * 3600 + parseInt(time[1]) * 60 + parseInt(time[2])
      );
    }

    function toTwoDigitString(value: number): string {
      if (value < 10) {
        return "0" + value;
      } else {
        return "" + value;
      }
    }

    function toTime(timeInSeconds: number): string {
      const seconds = timeInSeconds % 60;
      const minutes = Math.idiv(timeInSeconds - seconds, 60) % 60;
      const hours = Math.idiv(timeInSeconds - seconds - minutes * 60, 3600);
      return [
        toTwoDigitString(hours),
        toTwoDigitString(minutes),
        toTwoDigitString(seconds),
      ].join(":");
    }

    function calculateTime(): string {
      if (!espState || !espState.clock) {
        return "00:00:00";
      }

      const refSecs = toSeconds(espState.clock.time);
      const deltaUpdateSecs = Math.idiv(
        control.millis() - espState.clock.lastTimeUpdate,
        1000
      );
      const newSecs = (refSecs + deltaUpdateSecs) % (24 * 60 * 60);
      return toTime(newSecs);
    }

    /**
     * Returns the time.
     */
    //% subcategory="Zoom"
    //% blockId=makerbit_zoom_time
    //% block="time %timezone=makerbit_helper_timezone"
    //% weight=56
    export function getTime(timeZone: string): string {
      autoConnectToESP();
      if (
        !espState.clock &&
        espState.connectionStatus >= ZoomConnectionStatus.INTERNET
      ) {
        refreshTimeNetwork(timeZone);
        basic.pause(1000);
      }
      return calculateTime();
    }

    /**
     * Configures the WiFi connection.
     * @param ssid network name
     * @param password password
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_connect_wifi"
    //% block="zoom connect to WiFi network %ssid | and password %password"
    //% weight=98
    export function connectWiFi(ssid: string, password: string): void {
      autoConnectToESP();
      espState.ssid = ssid;
      espState.wiFiPassword = password;
      setWiFi();
    }

    function setWiFi() {
      const msg = [
        'wifi "',
        espState.ssid,
        '" "',
        espState.wiFiPassword,
        '"\n',
      ].join("");
      serialWriteString(msg);
    }

    function getDeviceAndConnectionStatus(): void {
      // poll for device version
      espState.obtainDeviceJobId = background.schedule(
        () => {
          if (espState.device.isEmpty()) {
            serialWriteString("device\n");
          } else {
            background.remove(espState.obtainDeviceJobId);

            // poll for intial connection status
            espState.obtainConnectionStatusJobId = background.schedule(
              () => {
                if (espState.connectionStatus <= ZoomConnectionStatus.NONE) {
                  serialWriteString("connection-status\n");
                } else {
                  background.remove(espState.obtainConnectionStatusJobId);
                }
              },
              850,
              background.Mode.Repeat
            );
          }
        },
        300,
        background.Mode.Repeat
      );
    }

    /**
     * Connects the ESP8266 device to the 3V Analog Grove socket.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_connect_esp_analog_grove_3v"
    //% block="zoom connect ESP to 3V Analog Grove socket"
    //% weight=99
    export function connectESPtoAnalogGrove3V(): void {
      connectESP(DigitalPin.P0, DigitalPin.P1);
    }

    /**
     * Connects the ESP8266 device to the 5V I/O Grove socket.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_connect_esp_io_grove_5v"
    //% block="zoom connect ESP to 5V I/O Grove socket"
    //% weight=98
    export function connectESPtoIoGrove5V(): void {
      connectESP(DigitalPin.P5, DigitalPin.P8);
    }

    /**
     * Connects to the ESP8266 device.
     * @param espTx ESP8266 device transmitter pin (TX)
     * @param espRx ESP8266 device receiver pin (RX)
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_connect_esp"
    //% block="zoom connect with ESP RX attached to %espRX | and ESP TX to %espTX"
    //% espRX.defl=DigitalPin.P0
    //% espRX.fieldEditor="gridpicker"
    //% espRX.fieldOptions.columns=3
    //% espRX.fieldOptions.tooltips="false"
    //% espTX.defl=DigitalPin.P1
    //% espTX.fieldEditor="gridpicker"
    //% espTX.fieldOptions.columns=3
    //% espTX.fieldOptions.tooltips="false"
    //% weight=97
    //% blockHidden=true
    export function connectESP(espRX: DigitalPin, espTX: DigitalPin): void {
      if (control.isSimulator()) {
        serialWriteString = (text: string) => { };
      }

      if (!espState || espState.espRX != espRX || espState.espTX != espTX) {
        serial.setRxBufferSize(32);
        serial.setTxBufferSize(32);

        serial.redirect(
          espRX as number,
          espTX as number,
          BaudRate.BaudRate9600
        );

        // establish clean connection
        while (serial.read() != -1) { }
        serialWriteString("----- -----\n");
      }

      if (!espState) {
        espState = {
          subscriptions: [],
          lastError: 0,
          meeting: "" + randint(111111111, 999999999),
          room: "1",
          connectionStatus: ZoomConnectionStatus.NONE,
          notifiedConnectionStatus: -1,
          device: "",
          espRX: espRX,
          espTX: espTX,
          ssid: "",
          wiFiPassword: "",
          obtainDeviceJobId: 0,
          obtainConnectionStatusJobId: 0,
          transmissionControl: false,
          clock: undefined,
        };

        control.runInParallel(readSerialMessages);

        background.schedule(
          notifySubscriptionUpdates,
          20,
          background.Mode.Repeat
        );

        background.schedule(
          () => {
            serialWriteString("connection-status\n");
          },
          62000,
          background.Mode.Repeat
        );

        // Always notify connection status NONE in the beginning
        applyTopicUpdate(CONNECTION_TOPIC, "" + ZoomConnectionStatus.NONE);

        getDeviceAndConnectionStatus();
      }

      espState.espRX = espRX;
      espState.espTX = espTX;

      setMqttApplicationPrefix();

      if (!espState.ssid.isEmpty()) {
        setWiFi();
      }
    }

    /**
     * Returns the last error code.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_get_last_error"
    //% block="zoom error"
    //% weight=89
    export function getLastError(): number {
      if (!espState) {
        return 0;
      }
      return espState.lastError;
    }

    /**
     * Returns the ESP device firmware version.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_get_device"
    //% block="zoom device version"
    //% weight=88
    //% blockHidden=true
    export function getDevice(): string {
      if (!espState) {
        return "0";
      }
      return espState.device;
    }

    /**
     * Returns the connection status.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_get_connection_status"
    //% block="zoom connection"
    //% weight=90
    export function getConnectionStatus(): ZoomConnectionStatus {
      if (!espState) {
        return ZoomConnectionStatus.NONE;
      }
      return espState.connectionStatus;
    }

    function autoConnectToESP(): void {
      if (!espState) {
        makerbit.zoom.connectESP(DigitalPin.P0, DigitalPin.P1);
      }
    }

    /**
     * Broadcasts a string to other micro:bits that are connected to the same meeting room.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_send_string"
    //% block="zoom send string %value"
    //% value.shadowOptions.toString=true
    //% weight=79
    //% blockHidden=true
    export function sendString(value: string): void {
      autoConnectToESP();
      publish(STRING_TOPIC, value);
    }

    /**
     * Broadcasts a number to other micro:bits that are connected to the same meeting room.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_send_number"
    //% block="zoom send number %value"
    //% weight=80
    //% blockHidden=true
    export function sendNumber(value: number): void {
      autoConnectToESP();
      publish(NUMBER_TOPIC, "" + Math.roundWithPrecision(value, 2));
    }

    /**
     * Broadcasts a screenshot to other micro:bits that are connected to the same meeting room.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_send_screenshot"
    //% block="zoom send screenshot"
    //% weight=78
    export function sendScreenshot(): void {
      autoConnectToESP();
      publish(LED_TOPIC, "" + encodeImage(led.screenshot()));
    }

    /**
     * Broadcasts a number via a channel to other micro:bits that are connected to the same meeting room.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_send_number_to_channel"
    //% block="zoom send|number %value || to channel %channel"
    //% expandableArgumentMode="toggle"
    //% weight=80
    export function sendNumberToChannel(value: number, channel?: string): void {
      autoConnectToESP();
      publish(
        NUMBER_TOPIC + normalize(channel),
        "" + Math.roundWithPrecision(value, 2)
      );
    }

    /**
     * Broadcasts a string via a channel to other micro:bits that are connected to the same meeting room.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_send_string_to_channel"
    //% block="zoom send|string %value || to channel %channel"
    //% expandableArgumentMode="toggle"
    //% weight=79
    export function sendStringToChannel(value: string, channel?: string): void {
      autoConnectToESP();
      publish(STRING_TOPIC + normalize(channel), value);
    }

    /**
     * Sets the meeting and room for internet communications. A micro:bit can be connected to one room at any time.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_connect_meeting_room"
    //% block="zoom connect to meeting %meeting and room %room"
    //% meetingId.defl=123-456-7890
    //% room.defl=1
    //% weight=97
    export function connectMeetingRoom(meeting: string, room: string): void {
      autoConnectToESP();
      espState.room = room;
      espState.meeting = normalize(meeting);
      setMqttApplicationPrefix();
    }

    /**
     * Returns true if the specified connection level is reached or exceeded.
     * False otherwise.
     */
    //% subcategory="Zoom"
    //% blockId="makerbit_zoom_is_connected"
    //% block="zoom is connected to %state"
    //% weight=91
    export function isConnected(status: ZoomConnectionStatus): boolean {
      if (!espState) {
        return false;
      }
      basic.pause(0); // Allow background processing to happen, even if called in a tight loop
      return espState.connectionStatus >= status;
    }

    function setMqttApplicationPrefix() {
      const msg = [
        "mqtt-app ",
        espState.meeting,
        "/",
        espState.room,
        "\n",
      ].join("");
      serialWriteString(msg);
    }

    function encodeImage(image: Image): number {
      let bits = 0;
      for (let x = 0; x <= 4; x++) {
        for (let y = 0; y <= 4; y++) {
          bits = bits << 1;
          if (image.pixel(x, y)) {
            bits = bits + 1;
          }
        }
      }
      return bits;
    }

    function decodeImage(bits: number): Image {
      let img = images.createImage("");
      for (let x = 4; x >= 0; x--) {
        for (let y = 4; y >= 0; y--) {
          img.setPixel(x, y, (bits & 0x01) == 1);
          bits = bits >> 1;
        }
      }
      return img;
    }
  }
}
