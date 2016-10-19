import fs from 'fs'
import path from 'path'
import File from 'vinyl'
import vfs from 'vinyl-fs'
import _ from 'lodash'
import concat from 'concat-stream'
import GithubSlugger from 'github-slugger'
import {util} from 'documentation'
import hljs from 'highlight.js'
import badges from '@thebespokepixel/badges'
import remark from 'remark'
import addUsage from 'remark-usage'

const createFormatters = util.createFormatters
const createLinkerStack = util.createLinkerStack

function formatSignature(section, formatters, isShort) {
	let returns = ''
	let prefix = ''
	if (section.kind === 'class') {
		prefix = 'new '
	} else if (section.kind !== 'function') {
		return section.name
	}
	if (!isShort && section.returns) {
		returns = ' → ' +
			formatters.type(section.returns[0].type)
	}
	return prefix + section.name + formatters.parameters(section, isShort) + returns
}

export default function (comments, options, callback) {
	const linkerStack = createLinkerStack(options)
		.namespaceResolver(comments, namespace => {
			const slugger = new GithubSlugger()
			return '#' + slugger.slug(namespace)
		})

	const formatters = createFormatters(linkerStack.link)

	hljs.configure(options.hljs || {})

	badges('docs', true)
		.then(badgesAST => {
			const sharedImports = {
				imports: {
					badges() {
						return formatters.markdown(badgesAST)
					},
					usage(example, callback) {
						remark().use(addUsage, {
							example
						}).process('### Usage', (err, vfile) => {
							if (err) {
								console.error(`Error: ${err}`)
							} else {
								callback(remark().parse(vfile.contents))
							}
						})
					},
					slug(str) {
						const slugger = new GithubSlugger()
						return slugger.slug(str)
					},
					shortSignature(section) {
						return formatSignature(section, formatters, true)
					},
					signature(section) {
						return formatSignature(section, formatters)
					},
					md(ast, inline) {
						if (inline && ast && ast.children.length > 0 && ast.children[0].type === 'paragraph') {
							ast = {
								type: 'root',
								children: ast.children[0].children.concat(ast.children.slice(1))
							}
						}
						return formatters.markdown(ast)
					},
					formatType: formatters.type,
					autolink: formatters.autolink,
					highlight(example) {
						if (options.hljs && options.hljs.highlightAuto) {
							return hljs.highlightAuto(example).value
						}
						return hljs.highlight('js', example).value
					}
				}
			}

			sharedImports.imports.renderSectionList = _.template(fs.readFileSync(path.join(__dirname, 'parts/section_list._'), 'utf8'), sharedImports)
			sharedImports.imports.renderSection = _.template(fs.readFileSync(path.join(__dirname, 'parts/section._'), 'utf8'), sharedImports)
			sharedImports.imports.renderNote = _.template(fs.readFileSync(path.join(__dirname, 'parts/note._'), 'utf8'), sharedImports)

			const pageTemplate = _.template(fs.readFileSync(path.join(__dirname, 'parts/index._'), 'utf8'), sharedImports)

			// push assets into the pipeline as well.
			vfs.src([path.join(__dirname, 'assets', '**')], {base: __dirname})
				.pipe(concat(files => {
					callback(null, files.concat(new File({
						path: 'index.html',
						contents: new Buffer(pageTemplate({
							docs: comments,
							options
						}), 'utf8')
					})))
				}))
		})
}
