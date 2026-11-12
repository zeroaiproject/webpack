/*
	MIT License http://www.opensource.org/licenses/mit-license.php
*/

"use strict";

const memoize = require("../util/memoize");

const getHtmlSyntax = memoize(() => require("./syntax"));
const getHtmlParser = memoize(() => require("./syntax-parser"));

/** @import Compilation from "../Compilation" */
/** @import Module from "../module/Module" */
/** @import HtmlEntryDependency from "../dependencies/html/HtmlEntryDependency" */
/** @import HtmlInlineStyleDependency from "../dependencies/html/HtmlInlineStyleDependency" */

const WHITESPACE_SPLIT_REGEXP = /(\s+)/;
const CC_QUOTATION_MARK = 34;
const CC_APOSTROPHE = 39;

/**
 * @param {Module} module a CSS module
 * @param {Compilation} compilation compilation
 * @param {Map<string, string>} locals collected names, the first declaration of a name winning
 */
const addLocals = (module, compilation, locals) => {
	if (!module.buildMeta || !module.buildMeta.isCssModule) return;
	const results = /** @type {import("../module/CodeGenerationResults")} */ (
		compilation.codeGenerationResults
	).map.get(module);
	if (results === undefined) return;
	for (const result of results.values()) {
		/** @type {Map<string, string> | undefined} */
		const moduleLocals = result.data && result.data.get("cssLocals");
		if (moduleLocals === undefined) continue;
		for (const [name, value] of moduleLocals) {
			if (!locals.has(name)) locals.set(name, value);
		}
		return;
	}
};

/**
 * The names the page's CSS modules give its classes and ids: a `<style module>`
 * body's, and a linked stylesheet's that is a CSS module, in document order.
 * Read from what the page already holds, so a page without one costs a walk
 * over its dependencies and nothing more.
 * @param {Module} module the page's html module
 * @param {Compilation} compilation compilation
 * @returns {Map<string, string> | undefined} name -> scoped names, `undefined` when the page has no CSS module
 */
const getPageLocals = (module, compilation) => {
	const { moduleGraph } = compilation;
	/** @type {Map<string, string> | undefined} */
	let locals;
	for (const dep of module.dependencies) {
		if (
			dep.type !== "html inline style" ||
			!(/** @type {HtmlInlineStyleDependency} */ (dep).cssModule)
		) {
			continue;
		}
		const cssModule = moduleGraph.getModule(dep);
		if (!cssModule) continue;
		if (locals === undefined) locals = new Map();
		addLocals(cssModule, compilation, locals);
	}
	if (module.presentationalDependencies !== undefined) {
		for (const dep of module.presentationalDependencies) {
			if (
				dep.type !== "html entry" ||
				/** @type {HtmlEntryDependency} */ (dep).elementKind !== "stylesheet"
			) {
				continue;
			}
			// A linked stylesheet is an entry of its own; its type, and so whether
			// it scopes names, is the one its rules gave it.
			const entry = compilation.entries.get(
				/** @type {HtmlEntryDependency} */ (dep).entryName
			);
			if (entry === undefined) continue;
			for (const entryDep of entry.dependencies) {
				const cssModule = moduleGraph.getModule(entryDep);
				if (!cssModule || !cssModule.buildMeta) continue;
				if (!cssModule.buildMeta.isCssModule) continue;
				if (locals === undefined) locals = new Map();
				addLocals(cssModule, compilation, locals);
			}
		}
	}
	return locals !== undefined && locals.size > 0 ? locals : undefined;
};

/**
 * Rewrite a page's `class` and `id` values with the names its CSS modules give
 * them. A name none of them declares stays as written, so global classes keep
 * working; `composes` adds the names it pulls in. Run on the page as it is
 * emitted, once every stylesheet is generated, and only for a page with a CSS
 * module, so no other page is walked again. Selectors in scripts are not
 * rewritten.
 * @param {string} content the page's markup
 * @param {Module} module the page's html module
 * @param {Compilation} compilation compilation
 * @returns {string} the markup with scoped `class` and `id` values
 */
const rewriteCssModuleNames = (content, module, compilation) => {
	const locals = getPageLocals(module, compilation);
	if (locals === undefined) return content;
	const { SourceProcessor } = getHtmlSyntax();
	const { Field, NodeType, Part, escapeAttribute } = getHtmlParser();
	/** @type {[number, number, string][]} */
	const replacements = [];
	new SourceProcessor()
		.use({
			[NodeType.Element]: {
				enter: (path) => {
					const count = path.fieldCount(Field.attributes);
					for (let i = 0; i < count; i++) {
						const attr = path.field(i, Field.attributes);
						const name = path.name(attr);
						const isId = name === "id";
						if (!isId && name !== "class") continue;
						const start = path.startOf(Part.value, attr);
						if (start === -1) continue;
						const value = path.value(attr);
						/** @type {string | undefined} */
						let result;
						if (isId) {
							const scoped = locals.get(value.trim());
							// `composes` gives a class more than one name; an id has one.
							if (scoped !== undefined) result = scoped.split(" ")[0];
						} else {
							const parts = value.split(WHITESPACE_SPLIT_REGEXP);
							let changed = false;
							for (let j = 0; j < parts.length; j += 2) {
								const scoped = locals.get(parts[j]);
								if (scoped !== undefined) {
									parts[j] = scoped;
									changed = true;
								}
							}
							if (changed) result = parts.join("");
						}
						if (result === undefined) continue;
						const quote = content.charCodeAt(start - 1);
						const quoted =
							quote === CC_QUOTATION_MARK || quote === CC_APOSTROPHE;
						const escaped = escapeAttribute(
							result,
							quote === CC_APOSTROPHE ? CC_APOSTROPHE : CC_QUOTATION_MARK
						);
						replacements.push([
							start,
							path.endOf(Part.value, attr),
							// An unquoted value is quoted once `composes` gives it a space.
							quoted || !/\s/.test(escaped) ? escaped : `"${escaped}"`
						]);
					}
				}
			}
		})
		.process(content, { skip: { text: true } });
	if (replacements.length === 0) return content;
	replacements.sort((a, b) => a[0] - b[0]);
	let out = "";
	let last = 0;
	for (const [start, end, text] of replacements) {
		out += content.slice(last, start) + text;
		last = end;
	}
	return out + content.slice(last);
};

module.exports = rewriteCssModuleNames;
module.exports.getPageLocals = getPageLocals;
