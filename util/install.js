var fs    = require('fs'),
    path  = require('path')

var isGlobal = process.env.npm_config_global
var configPath = path.resolve(process.env[(process.platform === 'win32') ? 'USERPROFILE' : 'HOME'], '.ircnode')
var configFile = path.resolve(configPath, 'config')
var userFile   = path.resolve(configPath, 'users.json')
var hostFile   = path.resolve(configPath, 'hosts.json');
var pluginDir  = path.resolve(configPath, 'plugins/')

var exists = path.existsSync(configPath)
if (!exists) {
  fs.mkdirSync(configPath, '0755')
  fs.mkdir(pluginDir, '0755')
}

var review_required = false
;[configFile, userFile, hostFile].forEach(function (file) {
  var exists = path.existsSync(file)
  if (!exists) {
    var sample_file = './' + path.basename(file)
    fs.writeFileSync(file, fs.readFileSync(sample_file))
    review_required = true
  }
})

if (review_required)
  console.log('Please review the configuration files in ' + configPath)

;['sample', 'exec'].forEach(function (plugin) {
  var pluginPath = path.resolve(pluginDir, plugin + '.js')
  var exists = path.existsSync(pluginPath)
  if (!exists) {
    var file = path.resolve('plugins', path.basename(pluginPath))
    fs.writeFileSync(pluginPath, fs.readFileSync(file))
  }
})
