'use strict';

var utilx = require('utilx')
var socketClient = require('socket.io-client')
var browsers = require('browsers')
var os = require('os')

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

  // if the browser is not opening and closing
  this.free = {/*browserName: true*/}

  var socket = this.socket = socketClient.connect(cfg.server + '/__labor')

  socket.on('connect', function() {
    logger.debug('Socket connect.')
    that.getBrowsers(function() {
      var initInfo = that.getInitInfo()
      logger.debug('Init info', initInfo)
      socket.emit('init', initInfo)

      initInfo.forEach(function(ua) {
        var browserName = ua.browser.name

        // TODO
        // why need a queue?
        that.queues[browserName] = []

        that.free[browserName] = true
      })
    })
  })

  socket.on('add', function(data) {
    logger.debug('Add order', {orderId: data.orderId, laborId: data.laborId})

    var browserName = data.ua.browser.name
    if (that.free[browserName]) {
      logger.debug(browserName, 'is free, will open it immediately.')
      that.add(data)

    } else {
      logger.debug(browserName, 'is locked, will queue.')
      that.queues[browserName].push(['add', data])
    }
  })

  socket.on('remove', function(data) {
    logger.debug('Remove order', {orderId: data.orderId, laborId: data.laborId})

    var browserName = data.ua.browser.name
    if (that.free[browserName]) {
      logger.debug(browserName, 'is free, will close it immediately.')
      that.remove(data)

    } else {
      var q = that.queues[browserName]
      if (q.length) {
        logger.debug(browserName,
          'is locked, will discard the last open action',
          that.queues[browserName].pop())

      } else {
        logger.debug(browserName, 'is locked, will queue.')
        q.push(['remove', data])
      }
    }
  })

  socket.on('disconnect', function() {
    logger.debug('Socket disconnect.')
  })
}


Driver.prototype.add = function(data) {
  var that = this
  var browserName = data.ua.browser.name
  var browser = this.browsers[browserName]

  this.free[browserName] = false

  var orderId = data.orderId
  var laborId = data.laborId
  var href = data.href.replace(/https?\:\/\/[^/]+?\//, this.cfg.server + '/')
  var hasQuery = href.indexOf('?') !== -1
  var src = href.replace(
    /(#.*$)|$/,
    (hasQuery ? '&' : '?') +'__totoro_oid=' + orderId +
    '&' + '__totoro_lid=' + laborId +
    '$1')

  browser.open(src, function() {
    // code for debug queue
    /*
    setTimeout(function() {
      that.free[browserName] = true
      that.autoCb(browserName)
    }, 10000)
    */

    that.free[browserName] = true
    that.autoCb(browserName)
  })

  this.orders[browserName] = browser
}


Driver.prototype.remove = function(data) {
  var that = this
  var browserName = data.ua.browser.name
  var browser = this.orders[browserName]

  this.free[browserName] = false

  browser.close(function() {
    /*
    setTimeout(function() {
      that.free[browserName] = true
      that.autoCb(browserName)
    }, 10000)
    */

    that.free[browserName] = true
    that.autoCb(browserName)
  })

  ;delete this.orders[browserName]
}


Driver.prototype.autoCb = function(browserName) {
  var q = this.queues[browserName]
  if (!q.length) return
  var item = q.shift()
  this[item[0]](item[1])
}


Driver.prototype.removeAll = function(cb) {
  logger.debug('Remove all orders.')

  var that = this

  // remove all waiting actions
  Object.keys(this.queues).forEach(function(k) {
    that.queues[k] = []
  })

  var keys = Object.keys(this.orders)
  var count = keys.length

  if (!count) cb()

  keys.forEach(function(browserName) {
    that.orders[browserName].close(function() {
      if (--count === 0) {
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
      browser: {
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



Driver.prototype.closeOnExit = function() {
  var that = this
  // NOTE
  // must close all browsers when CTRL + C, or
  //   1. if safari on mac os it will reopend with previous tab
  //   2. all browsers on win xp won't close
  process.on('SIGINT', function() {
    logger.info('Receive signal SIGINT.')
    that.removeAll(function() {
      process.exit(0)
    })
  })

  // also close all browsers when catch an error
  process.on('uncaughtException', function(err) {
    logger.info('Caught exception.')
    logger.info(err)
    that.removeAll(function() {
      process.exit(1)
    })
  })

  this.closeOnExit = function() {}
}


function handleCfg(cfg) {
  var fileCfg = utilx.readJSON('./browsers-driver.json')
  utilx.mix(cfg, fileCfg, {
    browsers: browsers.availableBrowsers,
    server: 'http://server.totorojs.org:9999'
  })

  if (cfg.server.indexOf('http') === -1) cfg.server = 'http://' + cfg.server
  logger.debug('Handled config.', cfg)
  return cfg
}

