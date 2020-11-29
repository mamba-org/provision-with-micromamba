const core = require('@actions/core')
const yaml = require('js-yaml')
const fs = require('fs')
const exec = require('@actions/exec').exec
const path = require('path')

async function execute (command) {
  console.log('bash -c "' + command + '"')
  await exec(command)
}

async function run () {
  try {
    const envFileName = core.getInput('environment-file')
    console.log(envFileName)
    const envFilePath = path.join(process.env.GITHUB_WORKSPACE || '', envFileName)
    console.log(envFilePath)

    const envYaml = yaml.safeLoad(fs.readFileSync(envFilePath, 'utf-8'))
    const envName = envYaml.name
    core.startGroup('Installing environment ' + envName + '...')

    execute('rm -f ~/.bashrc')
    execute('rm -f ~/.bash_profile')
    execute('rm -f ~/.profile')
    execute('touch ~/.bashrc')
    execute('wget -qO- https://micromamba.snakepit.net/api/micromamba/linux-64/latest | tar -xvj bin/micromamba --strip-components=1')
    execute('./micromamba shell init -s bash -p ~/micromamba')
    execute('mkdir -p ~/micromamba/pkgs/')
    execute('echo "set -eo pipefail" >> ~/.bashrc')
    execute('echo "micromamba activate ' + envName + '" >> ~/.bashrc')
    execute('mv ~/.bashrc ~/.profile')
    execute('source ~/.profile && micromamba create -f ' + envFilePath + ' -y')

    execute('')
    core.endGroup()
  } catch (error) {
    core.setFailed(error.message)
  }
}

run()
