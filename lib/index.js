'use strict';

var utilx = require('utilx')
var socketClient = require('socket.io-client')
var browsers = require('browsers')
var os = require('os')
var inherits = require('util').inherits
var EventEmitter = require('events').EventEmitter

var logger = require('./logger')

var platform = process.platform
if (platform !== 'win32' && platform !== 'darwin')
  logger.error('Platform', platform, 'is not supported now.')

var osNameMap = {
  'win32': 'windows',
  'darwin': 'macosx'
}

var deviceNameMap = {
  'win32': 'pc',
  'darwin': 'mac'
}

module.exports = Driver


function Driver(cfg) {
  var that = this
  this.cfg = handleCfg(cfg)
  this.orders = {}
  this.queues = {/*browserName: [[action, data], ...]*/}
  this.freeze = false

  // if the browser is not opening and closing
  this.free = {/*browserName: true*/}

  var socket = this.socket = socketClient.connect(cfg.server + '/__labor')

  socket.on('connect', function() {
    logger.debug('Socket connect.')
    that.getBrowsers(function() {
      var initInfo = that.getInitInfo()
      logger.debug('Init info', initInfo)
      socket.emit('init', initInfo)

      initInfo.forEach(function(laborTrait) {
        var browserName = laborTrait.agent.name

        // TODO
        // why need a queue?
        that.queues[browserName] = []
        that.free[browserName] = true
      })
    })
  })

  socket.on('add', function(data) {
    if (this.freeze) return
    that.add(data)
  })

  socket.on('remove', function(data) {
    if (this.freeze) return
    that.remove(data)
  })

  socket.on('disconnect', function() {
    logger.debug('Socket disconnect.')
    Object.keys(that.orders).forEach(function(browserName) {
      that.remove(browserName)
    })
  })
}


inherits(Driver, EventEmitter)


Driver.prototype.add = function(data) {
  logger.debug('Add order', data)

  var browserName = data.laborTrait.agent.name
  if (this.free[browserName]) {
    logger.debug(browserName, 'is free, will open it immediately.')
    this.open(data)

  } else {
    logger.debug(browserName, 'is locked, will queue.')
    this.queues[browserName].push(['open', data])
  }
}


Driver.prototype.open = function(data) {
  var that = this
  var browserName = data.laborTrait.agent.name
  var browser = this.browsers[browserName]

  this.free[browserName] = false
  browser.open(data.url, function() { that.autoCb(browserName) })
  this.orders[browserName] = browser
}


Driver.prototype.remove = function(data) {
  var browserName
  if (typeof data === 'string') {
    logger.debug('Remove order <', data, '>')
    browserName = data
  } else {
    logger.debug('Remove order', data)
    browserName = data.laborTrait.agent.name
  }

  if (this.free[browserName]) {
    logger.debug(browserName, 'is free, will close it immediately.')
    this.close(data)

  } else {
    var q = this.queues[browserName]
    if (q.length) {
      var lastAction = q[q.length - 1][0]
      if (lastAction === 'open') {
        logger.debug(browserName,
            'is locked, will discard the last open action',
            q.pop())

      } else {
        logger.debug(browserName,
            'is locked, the last queued action is close,',
            'will ignore this close.')
      }

    } else {
      logger.debug(browserName, 'is locked, will queue.')
      q.push(['close', data])
    }
  }
}


Driver.prototype.close = function(data) {
  var that = this
  var browserName

  if (typeof data === 'string') {
    browserName = data
  } else {
    browserName = data.laborTrait.agent.name
  }
  var browser = this.orders[browserName]

  this.free[browserName] = false
  browser.close(function() {
    setTimeout(function() {
      that.autoCb(browserName)
    }, 1000);
  })
  ;delete that.orders[browserName]
}


Driver.prototype.autoCb = function(browserName) {
  var that = this
  var q = this.queues[browserName]
  if (q.length) {
    var item = q.shift()
    this[item[0]](item[1])
  } else {
    this.free[browserName] = true
    if (Object.keys(this.free).every(function(bn) {
      return that.free[bn]
    })) {
      logger.debug('Emit all free event.')
      that.emit('allFree')
    }
  }
}


Driver.prototype.getBrowsers = function(cb) {
  var that = this

  if (this.browsers) {
    cb()
    return
  }

  this.browsers = {}
  var count = this.cfg.browsers.length
  this.cfg.browsers.forEach(function(name) {
    browsers.get(name, function(browser) {
      if (browser) that.browsers[name] = browser
      if (--count === 0) {
        that.closeOnExit()
        cb()
      }
    })
  })
}


Driver.prototype.getInitInfo = function() {
  var that = this
  var info = []
  Object.keys(this.browsers).forEach(function(name) {
    info.push({
      agent: {
        name: name,
        version: that.browsers[name].version
      },
      os: {
        name: osNameMap[platform],
        version: os.release()
      },
      device: {
        name: deviceNameMap[platform]
      }
    })
  })
  return info
}


Driver.prototype.closeOnExit = function() {
  var that = this
  // NOTE
  // must close all browsers when CTRL + C, or
  //   1. if safari on mac os it will reopend with previous tab
  //   2. all browsers on win xp won't close
  process.on('SIGINT', function() {
    logger.info('Receive signal SIGINT.')
    that.freeze = true
    that.destroy(function() {
      process.exit(0)
    })
  })

  // also close all browsers when catch an error
  process.on('uncaughtException', function(err) {
    logger.info('Caught exception.')
    logger.info(err)
    that.freeze = true
    that.destroy(function() {
      process.exit(1)
    })
  })

  this.closeOnExit = function() {}
}


Driver.prototype.destroy = function(cb) {
  logger.debug('Destroy before exit.')
  var that = this
  var allFree = true

  // NOTE
  // listen SIGINT and uncaught exception
  // we need to disconnect socket by hand
  // or it may exist after process exit for a while
  that.socket.disconnect()

  // clean queue
  var queueKeys = Object.keys(this.queues)
  queueKeys.forEach(function(browserName) {
    var q = that.queues[browserName]
    if (q.length) {
      allFree = false
      var firstAction = q[0][0]
      if (firstAction === 'open') {
        that.queues[browserName] = []
      } else {
        that.queues[browserName] = ['close', browserName]
      }
    }
  })

  // remove all opened orders
  var orderKeys = Object.keys(this.orders)
  if (orderKeys.length) allFree = false

  orderKeys.forEach(function(browserName) {
    that.remove(browserName)
  })

  if (allFree) {
    cb()
  } else {
    this.on('allFree', function() { cb() })
  }
}


function handleCfg(cfg) {
  var fileCfg = utilx.readJSON('./totoro-driver.json')
  utilx.mix(cfg, fileCfg, {
    browsers: browsers.availableBrowsers,
    server: 'http://server.totorojs.org:9999'
  })

  if (cfg.server.indexOf('http') === -1) cfg.server = 'http://' + cfg.server
  logger.debug('Handled config.', cfg)
  return cfg
}

