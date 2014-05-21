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

  var socket = this.socket = socketClient.connect(cfg.server + '/__labor')

  socket.on('connect', function() {
    logger.debug('Socket connect.')
    that.getBrowsers(function() {
      var initInfo = that.getInitInfo()
      logger.debug('Init info', initInfo)
      socket.emit('init', initInfo)
    })
  })

  socket.on('add', function(data) {
    that.add(data)
  })

  socket.on('remove', function(data) {
    that.remove(data)
  })

  socket.on('disconnect', function() {
    logger.debug('Socket disconnect.')
  })
}


Driver.prototype.add = function(data) {
  var orderId = data.orderId
  var laborId = data.laborId
  var href = data.href.replace(/https?\:\/\/[^/]+?\//, this.cfg.server + '/')
  var hasQuery = href.indexOf('?') !== -1
  var src = href.replace(
    /(#.*$)|$/,
    (hasQuery ? '&' : '?') +'__totoro_oid=' + orderId +
    '&' + '__totoro_lid=' + laborId +
    '$1')

  var browser = this.browsers[data.ua.browser.name]
  browser.open(src)

  var orderKey = orderId + '-' + laborId
  this.orders[orderKey] = browser

  logger.debug('Add order <', src, '>')
}


Driver.prototype.remove = function(data) {
  var orderKey

  // when socket disconnect, will pass order key in to close all runners
  if (typeof data === 'string' && data in this.orders) {
    orderKey = data
  } else {
    orderKey = data.orderId + '-' + data.laborId
  }

  var browser = this.orders[orderKey]
  browser.close()

  logger.debug('Remove order <', orderKey, '>')
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


// NOTE
// must close all browsers when CTRL + C, or
// 1. if safari on mac os it will reopend with previous tab
// 2. all browsers on win xp won't close
Driver.prototype.closeOnExit = function() {
  process.on('SIGINT', function() {
    logger.debug('About to close browsers before process exit.')
    // TODO
    process.exit(0)
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

