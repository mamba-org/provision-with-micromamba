const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const exec = require('@actions/exec').exec
const path = require('path')

async function execute (command) {
  try {
    console.log('bash -c "' + command + '"')
    await exec('bash -c "' + command + '"')
  } catch (error) {
    core.setFailed(error.message)
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

    await execute('rm -f ~/.bashrc')
    await execute('rm -f ~/.bash_profile')
    await execute('rm -f ~/.profile')
    await execute('touch ~/.bashrc')
    await execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    await execute('./micromamba shell init -s bash -p ~/micromamba')
    await execute('mkdir -p ~/micromamba/pkgs/')
    await execute('echo "set -eo pipefail" >> ~/.bashrc')
    await execute('echo "micromamba activate ' + envName + '" >> ~/.bashrc')
    await execute('mv ~/.bashrc ~/.profile')
    await execute('source ~/.profile && micromamba create -f ' + envFilePath + ' -y')
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
