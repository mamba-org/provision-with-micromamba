const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const os = require('os')
const io = require('@actions/io')
const exec = require('@actions/exec').exec
const path = require('path')

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
    console.log(envFileName)
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    console.log(envFilePath)
    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf-8'))
    const envName = envYaml.name

    console.log('Installing environment ' + envName + '...')

    await io.rmRF(path.join(os.homedir(), '.bashrc'))
    await io.rmRF(path.join(os.homedir(), '.bash_profile'))
    await io.rmRF(path.join(os.homedir(), '.profile'))
    touch(path.join(os.homedir(), '.bashrc'))
    await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await io.mkdirP(path.join(os.homedir(), 'micromamba/pkgs/'))
    await io.mv(path.join(os.homedir(), '.bashrc'), path.join(os.homedir(), '.profile'))
    await execute('source ~/.profile && micromamba create -f ' + envFilePath + ' -y')
    fs.appendFileSync(path.join(os.homedir(), '.profile'), 'set -eo pipefail\n')
    fs.appendFileSync(path.join(os.homedir(), '.profile'), 'micromamba activate\n' + envName)
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
