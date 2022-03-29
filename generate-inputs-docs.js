const fs = require('fs')
const jsYaml = require('js-yaml')

const GENERATED_MARKER_START = '<!-- generated by generate-inputs-docs.js -->'
const GENERATED_MARKER_END = '<!-- end generated -->'

function generateInputsDocs (inputs) {
  let markdown = ''
  for (const inputName in inputs) {
    const input = inputs[inputName]
    const optionalStr = input.required ? '' : '(Optional) '
    markdown += `\n### \`${inputName}\`\n\n${optionalStr}${input.description}\n`
  }
  return markdown
}

function main () {
  const yaml = jsYaml.safeLoad(fs.readFileSync('action.yml'))
  const inputsDocs = generateInputsDocs(yaml.inputs)
  const oldReadmeContent = fs.readFileSync('README.md').toString()
  const newReadmeContent = oldReadmeContent.replace(
    new RegExp(GENERATED_MARKER_START + '.+' + GENERATED_MARKER_END, 'ms'),
    GENERATED_MARKER_START + '\n' + inputsDocs + '\n' + GENERATED_MARKER_END
  )
  fs.writeFileSync('README.md', newReadmeContent)
}

main()