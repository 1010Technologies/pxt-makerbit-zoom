makerbit.zoom.connectESP(DigitalPin.P0, DigitalPin.P1);
makerbit.zoom.connectWiFi("network", "secret");
makerbit.zoom.connectMeetingRoom("123-456-789-0", "1");
makerbit.zoom.waitForConnection(ZoomConnectionStatus.MEETING);

const isConnected: boolean = makerbit.zoom.isConnected(
  ZoomConnectionStatus.MEETING
);
const status: number = makerbit.zoom.getConnectionStatus();
const error: number = makerbit.zoom.getLastError();
const device: string = makerbit.zoom.getDevice();

makerbit.zoom.sendNumber(1);
makerbit.zoom.sendString("hello world");
makerbit.zoom.sendScreenshot();
makerbit.zoom.sendNumberToChannel(23, "compass");
makerbit.zoom.sendStringToChannel("Ernie", "name");

makerbit.zoom.onReceivedNumber((value: number) => { });
makerbit.zoom.onReceivedString((value: string) => { });
makerbit.zoom.onReceivedScreenshot((screenshot: Image) => { });
makerbit.zoom.onReceivedNumberInChannel("compass", (value: number) => { });
makerbit.zoom.onReceivedStringInChannel("name", (value: string) => { });
makerbit.zoom.onConnectionStatus(() => { });
makerbit.zoom.onError(() => { });

makerbit.zoom.setTimeZone(makerbit.timezone(TimeZone.UTC));
makerbit.zoom.setTimeZoneWithUtcOffset(-8, 0);
const time: string = makerbit.zoom.getTime();
const date: string = makerbit.zoom.getDate();
const weekday: number = makerbit.zoom.getWeekday();