"use strict";

const { fixture } = require("../../helpers/fixture");

/** @import { MatDocument, MatElement } from "../../helpers/materializeHtmlTree" */

const {
	A,
	Field,
	NodeType,
	decodeXmlAttribute,
	decodeXmlEntities,
	escapeXmlAttribute,
	parseHtml: parseHtmlRefs
} = require("../../../lib/html/syntax-parser");
const { materialize } = require("../../helpers/materializeHtmlTree");

/**
 * @param {string} src source
 * @param {import("../../../lib/html/syntax-parser").HtmlAstSkip=} skip skip options
 * @returns {MatDocument} materialized XML document
 */
const parseXml = (src, skip) => {
	const doc = parseHtmlRefs(src, 0, { xml: true, skip });
	return {
		type: NodeType.Document,
		children: A.children(doc).map(materialize)
	};
};

/**
 * @param {import("../../../lib/html/syntax-parser").HtmlElement} element element
 * @param {string} name attribute name
 * @returns {string} the attribute's value as the tree hands it out
 */
const attributeValue = (element, name) =>
	A.value(A.fieldNamed(Field.attributes, name, element));

// What the parser builds and reports for each fixture, under each option a
// fixture's `parse.json` names, is in `invariants.unittest.js`'s snapshot;
// these hold its accessors and inputs too large to snapshot.
describe("XmlSyntax — parsing", () => {
	it("should expose XML attribute values through the shared path", () => {
		const source = fixture("xml", "xml-syntax-parsing-should-expose-xml-attribute-values-through-the-shared-path");
		const document = parseHtmlRefs(source, 0, { xml: true });
		const root = A.child(1, document);
		const attribute = A.fieldNamed(Field.attributes, "value", root);
		expect(A.value(attribute)).toBe("declared &\u0080&nbsp;");
		expect(A.value(attribute)).toBe("declared &\u0080&nbsp;");
	});

	it("should decode an XML attribute only once per parse", () => {
		const value = "x".repeat(400000);
		const source = `<!DOCTYPE root [<!ENTITY value "${value}">]><root value="&value;"/>`;
		const document = parseHtmlRefs(source, 0, { xml: true });
		const attribute = A.fieldNamed(Field.attributes, "value", A.child(1, document));
		for (let i = 0; i < 4; i++) expect(A.value(attribute) === value).toBe(true);
		const next = parseHtmlRefs(fixture("xml", "xml-syntax-parsing-should-decode-an-xml-attribute-only-once-per-parse"), 0, { xml: true });
		expect(A.value(A.fieldNamed(Field.attributes, "value", A.child(0, next)))).toBe("next");
	});

	it("should resolve an XML attribute's references as its start tag is read", () => {
		// A declaration after the tag does not reach back into it, whenever it is read.
		const document = parseHtmlRefs(
			'<r><a v="&e;" w="x\ty"/><!DOCTYPE r [<!ENTITY e "late">]><b v="&e;" w="1&#10;2" x="p\r\nq"/></r>',
			0,
			{ xml: true }
		);
		const root = A.child(0, document);
		const second = A.child(1, root);
		expect(attributeValue(second, "x")).toBe("p q");
		expect(attributeValue(second, "w")).toBe("1\n2");
		expect(attributeValue(second, "v")).toBe("late");
		const first = A.child(0, root);
		expect(attributeValue(first, "w")).toBe("x y");
		expect(attributeValue(first, "v")).toBe("&e;");
		expect(attributeValue(first, "w")).toBe("x y");
	});

	it("should tell an XML attribute holding a reference from the text around it", () => {
		const document = parseHtmlRefs(
			'<r a="1" b="&lt;" c="2">&amp;<s d="3" e="&#38;" f=\'4\'/>x &amp; y<t g="5"/>&gt;</r>',
			0,
			{ xml: true }
		);
		const root = A.child(0, document);
		expect(attributeValue(root, "a")).toBe("1");
		expect(attributeValue(root, "b")).toBe("<");
		expect(attributeValue(root, "c")).toBe("2");
		const inner = A.child(1, root);
		expect(attributeValue(inner, "d")).toBe("3");
		expect(attributeValue(inner, "e")).toBe("&");
		expect(attributeValue(inner, "f")).toBe("4");
		expect(attributeValue(A.child(3, root), "g")).toBe("5");
	});

	it("should spend the expansion budget on XML attributes in document order", () => {
		const value = "x".repeat(400000);
		const document = parseHtmlRefs(
			`<!DOCTYPE r [<!ENTITY e "${value}">]><r><a v="&e;" p="1"/><b p="2" v="&e;"/><c v="&e;" p="3"/></r>`,
			0,
			{ xml: true }
		);
		const root = A.child(1, document);
		// Read last to first: the third reference is the one past the budget.
		expect(attributeValue(A.child(2, root), "v")).toBe("&e;");
		expect(attributeValue(A.child(2, root), "p")).toBe("3");
		expect(attributeValue(A.child(1, root), "v") === value).toBe(true);
		expect(attributeValue(A.child(1, root), "p")).toBe("2");
		expect(attributeValue(A.child(0, root), "v") === value).toBe(true);
	});

	it("should read the attributes of a tag an XML entity holds", () => {
		const document = parseHtmlRefs(
			"<!DOCTYPE r [<!ENTITY t \"<i k='&amp;v' n='p\tq'/>\">]><r>&t;<j k='a\nb'/></r>",
			0,
			{ xml: true }
		);
		const root = A.child(1, document);
		expect(attributeValue(A.child(1, root), "k")).toBe("a b");
		expect(attributeValue(A.child(0, root), "n")).toBe("p q");
		expect(attributeValue(A.child(0, root), "k")).toBe("&v");
	});

	it("should normalize an XML attribute first read after the parse, in any order", () => {
		// Inline: the tab, the line ends and the order of the reads are the test.
		const document = parseHtmlRefs(
			'<!DOCTYPE r [<!ENTITY e "x\ty">]><r a="1\t2\r\n3" b="&e;&#x41;" c="4\n5"><s d="6\r7" e="&amp;"/></r>',
			0,
			{ xml: true }
		);
		const root = A.child(1, document);
		const child = A.child(0, root);
		expect(attributeValue(child, "d")).toBe("6 7");
		expect(attributeValue(root, "c")).toBe("4 5");
		expect(attributeValue(child, "e")).toBe("&");
		expect(attributeValue(root, "a")).toBe("1 2 3");
		expect(attributeValue(root, "b")).toBe("x yA");
		expect(attributeValue(root, "c")).toBe("4 5");
	});

	it("should bound markup detection in deeply nested XML entities", () => {
		const declarations = [];
		for (let i = 0; i < 10000; i++) {
			declarations.push(`<!ENTITY e${i} "&e${i + 1};">`);
		}
		const source = `<!DOCTYPE root [${declarations.join("")}<!ENTITY e10000 "<child/>">]><root>&e0;<after/></root>`;
		const document = parseHtmlRefs(source, 0, { xml: true });
		const root = A.child(1, document);
		expect(A.name(A.child(1, root))).toBe("after");
	});

	it("should expand the internal entities the DTD declares", () => {
		const document = parseXml(
			fixture("xml", "xml-syntax-parsing-should-expand-the-internal-entities-the-dtd-declares")
		);
		const svg = /** @type {MatElement} */ (document.children[1]);
		expect(decodeXmlAttribute(svg.attributes[0].value)).toBe(
			"http://www.w3.org/2000/svg"
		);
		expect(svg.children[0]).toMatchObject({
			type: NodeType.Text,
			data: "http://www.w3.org/2000/svg & &undeclared;"
		});
	});

	it("should end the name of an entity reference in every code unit alike", () => {
		// What the name of a reference cannot hold: a delimiter, or what `\s` matches.
		const ends = /[\s&;#<>"'=/%]/;
		// What a declaration cannot name an entity with, so nothing resolves it.
		const undeclared = /[\0\t\n\r "'/<=>?[\]]/;
		let subset = "";
		for (let unit = 0; unit < 0x10000; unit++) {
			const character = String.fromCharCode(unit);
			if (!undeclared.test(character)) subset += `<!ENTITY n${character}m "1">`;
		}
		parseHtmlRefs(`<!DOCTYPE r [${subset}]><r/>`, 0, { xml: true });
		/** @type {number[]} */
		const unexpected = [];
		for (let unit = 0; unit < 0x10000; unit++) {
			const character = String.fromCharCode(unit);
			const reference = `&n${character}m;`;
			const resolves = !undeclared.test(character) && !ends.test(character);
			if (decodeXmlEntities(reference) !== (resolves ? "1" : reference)) {
				unexpected.push(unit);
			}
		}
		expect(unexpected).toEqual([]);
	});

	it("should resolve an XML reference of each form and leave any other `&` as written", () => {
		expect(decodeXmlEntities("&lt;&gt;&amp;&quot;&apos;")).toBe("<>&\"'");
		// A name a code unit away from a predefined one is the DTD's to resolve.
		const others =
			"&xt; &lx; &gx; &amq; &xmp; &quo1; &1uot; &apo1; &1pos; &LT; &Amp; &amp2; &l; &quot2;";
		expect(decodeXmlEntities(others)).toBe(others);
		expect(decodeXmlEntities("&#65;&#x41;&#x6a;&#x6A;&#0065;")).toBe("AAjjA");
		const malformed = "&#X41; &#x; &#; &#65 &#x41 &#xG; &#6x; & &; &a b; &a&";
		expect(decodeXmlEntities(malformed)).toBe(malformed);
		// Past U+10FFFF, however many digits, and what §2.2 `Char` leaves out.
		expect(
			decodeXmlEntities(
				"&#x110000;&#1114112;&#xFFFFFFFFFFFFFFFFFFFFFFFF;&#99999999999999999999999;&#0;&#xD800;&#65534;"
			)
		).toBe("\uFFFD".repeat(7));
		expect(decodeXmlEntities("&#x10FFFF;&#1114111;")).toBe("\u{10FFFF}\u{10FFFF}");
		expect(decodeXmlEntities("a&b&amp;c&lt")).toBe("a&b&c&lt");
		// A declaration may extend a predefined name, and cannot take one over.
		parseHtmlRefs('<!DOCTYPE r [<!ENTITY lt2 "two"><!ENTITY amp "shadow">]><r/>', 0, { xml: true });
		expect(decodeXmlEntities("&lt2;&amp;&lt;")).toBe("two&<");
	});

	it("should return an XML attribute value holding nothing to escape as it came", () => {
		expect(escapeXmlAttribute("plain value", '"')).toBe("plain value");
		expect(escapeXmlAttribute("it's", '"')).toBe("it's");
		expect(escapeXmlAttribute('say "hi"', "'")).toBe('say "hi"');
		expect(escapeXmlAttribute("a\"b'c<d&e\tf\ng\rh", '"')).toBe(
			"a&quot;b'c&lt;d&amp;e&#9;f&#10;g&#13;h"
		);
		expect(escapeXmlAttribute("a\"b'c", "'")).toBe("a\"b&apos;c");
	});

	it("should bound an entity bomb of markup", () => {
		// Inline, since the tree it builds would be an 18 MB snapshot.
		let subset = '<!ENTITY l0 "0123456789">';
		for (let i = 1; i < 10; i++) {
			subset += `<!ENTITY l${i} "${`&l${i - 1};`.repeat(10)}">`;
		}
		const markupBomb = /** @type {MatElement} */ (
			parseXml(
				`<!DOCTYPE r [<!ENTITY m "<m/>">${subset.replace('"0123456789"', '"&m;"')}]><r>&l9;</r>`
			).children[1]
		);
		expect(markupBomb.children.length).toBeLessThan(1 << 20);
	});
});
