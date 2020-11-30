module.exports =
/******/ (() => { // webpackBootstrap
/******/ 	var __webpack_modules__ = ({

/***/ 89:
/***/ ((__unused_webpack_module, __unused_webpack_exports, __webpack_require__) => {

const core = __webpack_require__(414)
const yaml = __webpack_require__(684)
const fs = __webpack_require__(747)
const os = __webpack_require__(87)
const io = __webpack_require__(56)
const exec = __webpack_require__(666).exec
const path = __webpack_require__(622)
const process = __webpack_require__(765)

async function execute (command) {
  try {
    await exec('bash', ['-c', command])
  } catch (error) {
    core.setFailed(error.message)
  }
}

function touch (filename) {
  // https://remarkablemark.org/blog/2017/12/17/touch-file-nodejs/
  const time = new Date()

  try {
    fs.utimesSync(filename, time, time)
  } catch (err) {
    fs.closeSync(fs.openSync(filename, 'w'))
  }
}

async function run () {
  try {
    const envFileName = core.getInput('environment-file')
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf-8'))
    const envName = envYaml.name
    let bashrc = ''
    if (process.platform === 'darwin') {
      bashrc = path.join(os.homedir(), '.bash_profile')
    } else {
      bashrc = path.join(os.homedir(), '.bashrc')
    }
    const condarc = path.join(os.homedir(), '.condarc')

    core.startGroup('Configuring conda...')
    touch(condarc)
    fs.appendFileSync(condarc, 'always_yes: true\n')
    fs.appendFileSync(condarc, 'show_channel_urls: true\n')
    fs.appendFileSync(condarc, 'channel_priority: strict\n')
    if (envYaml.channels !== undefined) {
      fs.appendFileSync(condarc, 'channels: [' + envYaml.channels.join(', ') + ']\n')
    }
    await execute('cat ' + condarc)
    core.endGroup()

    core.startGroup('Installing environment ' + envName + ' from ' + envFilePath + ' ...')
    // await io.rmRF(path.join(os.homedir(), '.bashrc'))
    // await io.rmRF(path.join(os.homedir(), '.bash_profile'))
    // await io.rmRF(profile)
    // touch(bashrc)
    if (process.platform === 'darwin') {
      await execute('curl -Ls https://micromamba.snakepit.net/api/micromamba/osx-64/latest | tar -xvj bin/micromamba')
      await io.mv('./bin/micromamba', './micromamba')
      await io.rmRF('./bin')
    } else {
      await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    }
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await io.mkdirP(path.join(os.homedir(), 'micromamba/pkgs/'))
    await execute('source ' + bashrc + ' && micromamba create --strict-channel-priority -y -f ' + envFilePath)

    fs.appendFileSync(bashrc, 'set -eo pipefail\n')
    fs.appendFileSync(bashrc, 'micromamba activate ' + envName + '\n')
    // await io.mv(bashrc, profile)
    core.endGroup()

    await execute('source ' + bashrc + ' && micromamba list')
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()


/***/ }),

/***/ 414:
/***/ ((module) => {

module.exports = eval("require")("@actions/core");


/***/ }),

/***/ 666:
/***/ ((module) => {

module.exports = eval("require")("@actions/exec");


/***/ }),

/***/ 56:
/***/ ((module) => {

module.exports = eval("require")("@actions/io");


/***/ }),

/***/ 684:
/***/ ((module) => {

module.exports = eval("require")("js-yaml");


/***/ }),

/***/ 747:
/***/ ((module) => {

"use strict";
module.exports = require("fs");;

/***/ }),

/***/ 87:
/***/ ((module) => {

"use strict";
module.exports = require("os");;

/***/ }),

/***/ 622:
/***/ ((module) => {

"use strict";
module.exports = require("path");;

/***/ }),

/***/ 765:
/***/ ((module) => {

"use strict";
module.exports = require("process");;

/***/ })

/******/ 	});
/************************************************************************/
/******/ 	// The module cache
/******/ 	var __webpack_module_cache__ = {};
/******/ 	
/******/ 	// The require function
/******/ 	function __webpack_require__(moduleId) {
/******/ 		// Check if module is in cache
/******/ 		if(__webpack_module_cache__[moduleId]) {
/******/ 			return __webpack_module_cache__[moduleId].exports;
/******/ 		}
/******/ 		// Create a new module (and put it into the cache)
/******/ 		var module = __webpack_module_cache__[moduleId] = {
/******/ 			// no module.id needed
/******/ 			// no module.loaded needed
/******/ 			exports: {}
/******/ 		};
/******/ 	
/******/ 		// Execute the module function
/******/ 		var threw = true;
/******/ 		try {
/******/ 			__webpack_modules__[moduleId](module, module.exports, __webpack_require__);
/******/ 			threw = false;
/******/ 		} finally {
/******/ 			if(threw) delete __webpack_module_cache__[moduleId];
/******/ 		}
/******/ 	
/******/ 		// Return the exports of the module
/******/ 		return module.exports;
/******/ 	}
/******/ 	
/************************************************************************/
/******/ 	/* webpack/runtime/compat */
/******/ 	
/******/ 	__webpack_require__.ab = __dirname + "/";/************************************************************************/
/******/ 	// module exports must be returned from runtime so entry inlining is disabled
/******/ 	// startup
/******/ 	// Load entry module and return exports
/******/ 	return __webpack_require__(89);
/******/ })()
;