# totoro-driver

Node test driver for totoro.

---

## 0. Features

- Detect available browsers.
- Open specified browser to run test.
- Close specified browser when test finished or timeout.

### Supported browsers

Both on mac and windows.

**Be mind that all browsers must be installed in default path.**

- Chrome
- Safari
- Firefox
- IE

## 1. Installation

### Install From npm

```
npm install totoro-driver -g
```

### Install From Github

to get the latest function

```
git clone git@github.com:totorojs/totoro-driver.git
cd totoro-driver
npm install -g
```

## 2. Quick Start

Link to totoro test server, and tell it a new availble chrome.

```
$ browsers --server server.totorojs.org:9999 --browsers chrome
```

## 3. Cli Options

#### -s, --server

Totoro test server.

Default: `server.totorojs.org:9999`

#### -b, --browsers

Specify browsers to open.

Default: all available browsers on OS.

#### -d, --debug

Show debug log.

#### -v, --version

Output version number.

#### -h, --help

Output usage information.



