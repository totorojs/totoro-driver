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

  var socket = this.socket = socketClient.connect(cfg.server)

  socket.on('connect', function() {
    logger.debug('Socket connect.')
    that.getBrowsers(function() {
      var initInfo = that.getInitInfo()
      logger.debug('Init info', initInfo)
      socket.emit('init', initInfo)
    })
  })

  socket.on('add', function(data) {
    logger.debug('Add order', data)
  })

  socket.on('remove', function(data) {
    logger.debug('Remove order', data)
  })

  socket.on('disconnect', function() {
    logger.debug('Socket disconnect.')
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
    server: 'http://server.totorojs.org:9999/__labor'
  })

  if (cfg.server.indexOf('http') === -1) cfg.server = 'http://' + cfg.server
  logger.debug('Handled config.', cfg)
  return cfg
}

