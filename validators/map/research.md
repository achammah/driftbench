# Research: validator map

Append only, one entry per research pass (docs/validators.md section 10.6): the question, the sources read (URL or path), what others do, what to try, and why.

## Iteration 1

Question: packages/generate/src/extract/tools.ts: numberPartitions ignores multipleOf, so schema-keywords.multiple-of loses its multiple and not-multiple values.

Sources read:
* <scratchpad>/research/testgen/dossier-specification.md (sources 33 and 34: equivalence partitioning, boundary values)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.2.1 (multipleOf)

What others do: multipleOf splits a numeric input into two partitions, a multiple and a non-multiple; partition testing covers each once.

What to try, and why: the tool pre-pass reads multipleOf: multiple and not-multiple, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 2

Question: packages/generate/src/extract/tools.ts: arrayPartitions ignores uniqueItems, so schema-keywords.unique-items loses its duplicate-items value.

Sources read:
* <scratchpad>/research/testgen/dossier-specification.md (source 6: Schemathesis generates edge cases and invalid inputs from a schema)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.4.3 (uniqueItems)

What others do: uniqueItems true makes an array with a repeated element invalid; schema-driven generators send that invalid case as its own input.

What to try, and why: the tool pre-pass reads uniqueItems: duplicate-items, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 3

Question: packages/generate/src/extract/tools.ts: arrayPartitions only renames the empty case for minItems, so schema-keywords.min-items loses below-min-items and at-min-items.

Sources read:
* <scratchpad>/research/testgen/dossier-specification.md (source 34: boundary values on and either side of each edge)
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.4.2 (minItems)

What others do: boundary value analysis tests on and just below each edge; minItems is an edge of the item count, so a test needs one item under it and exactly at it.

What to try, and why: the tool pre-pass reads minItems: below-min-items and at-min-items, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 4

Question: packages/generate/src/extract/tools.ts: numberPartitions reads exclusiveMinimum and exclusiveMaximum only as numbers, so a draft-04 schema (minimum with exclusiveMinimum true) gets inclusive bounds; schema-keywords.exclusive-minimum-boolean and exclusive-maximum-boolean prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.2.5 (exclusiveMinimum is a number since draft 6)
* packages/generate/src/extract/tools.ts doc comment (the accepted files include OpenAI and older tool formats, which carry draft-04 schemas)

What others do: draft 6 turned exclusiveMinimum and exclusiveMaximum from booleans that modify minimum and maximum into numbers; tool files from older generators still carry the boolean form.

What to try, and why: the tool pre-pass reads the draft-04 boolean exclusiveMinimum and exclusiveMaximum, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 5

Question: packages/generate/src/extract/tools.ts: typesOf returns no type for a property without type or properties, so a format or a minimum alone gives no partition; schema-keywords.format-without-type and minimum-without-type prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation sections 6.2 to 6.4 and 7.1 (each keyword applies to one instance type)
* <scratchpad>/research/testgen/dossier-specification.md (source 6: Schemathesis reads the schema as written, edge cases included)

What others do: a keyword constrains only its own instance type, so a schema with minimum and no type constrains numbers; a generator can treat the keyword as stating that type.

What to try, and why: the tool pre-pass infers a property's type from its keywords when the schema states none, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 6

Question: packages/generate/src/extract/tools.ts: partitionsOf adds null for a type list with null even when the enum already listed null, so schema-keywords.type-null gains a duplicate null-2 value.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.1.2 (enum: the instance equals one of the values; null is a value)
* <scratchpad>/research/testgen/dossier-specification.md (source 33: one case per partition, no duplicates within a class)

What others do: an enum member null and a null type state the same partition; equivalence partitioning keeps one case per class.

What to try, and why: the tool pre-pass gives null once when a nullable enum lists null, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 7

Question: packages/generate/src/extract/tools.ts: walk reads a property's keywords where it stands, so a property that is a $ref gives no partition; schema-keywords.ref-defs and ref-definitions prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 8.2.3.1 ($ref) and 8.2.4 ($defs); draft-07 used definitions
* <scratchpad>/research/testgen/dossier-specification.md (source 6: Schemathesis resolves references before generating)

What others do: a $ref is replaced by the schema it points at before validation; Pydantic and OpenAPI tool schemas put shared enums in $defs or definitions, so a generator resolves them first.

What to try, and why: the tool pre-pass reads a local $ref to $defs or definitions, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 8

Question: packages/generate/src/extract/tools.ts: stringPartitions reads format and pattern only, so a base64 contentEncoding gives no partition; schema-keywords.content-encoding proves it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 8.3 (contentEncoding: the string is encoded binary data)
* <scratchpad>/research/testgen/dossier-specification.md (source 6: Schemathesis sends invalid inputs next to valid ones)

What others do: contentEncoding states a string shape like format does; the shape gives a valid and an invalid partition.

What to try, and why: the tool pre-pass reads contentEncoding: well-formed and malformed, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 9

Question: packages/generate/src/extract/tools.ts: partitionsOf gives an object no partition from its key count, so schema-keywords.min-max-properties loses its four edges.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation sections 6.5.1 and 6.5.2 (maxProperties, minProperties)
* <scratchpad>/research/testgen/dossier-specification.md (source 34: boundary values on and either side of each edge)

What others do: minProperties and maxProperties bound the number of keys like minItems and maxItems bound items; boundary analysis tests each edge and the side outside it.

What to try, and why: the tool pre-pass reads minProperties and maxProperties, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 10

Question: packages/generate/src/extract/tools.ts: locate and readTools know tools and tool_schemas only, so a Gemini file ({ functionDeclarations } at the root or inside the tools list) gives no tool; tool-formats.gemini and gemini-nested prove it.

Sources read:
* https://ai.google.dev/gemini-api/docs/function-calling (tools hold functionDeclarations, each with name, description and parameters)
* packages/generate/src/extract/tools.ts doc comment (the shapes read today: lists, tools, tool_schemas, metadata.tool_schemas, the OpenAI wrapper)

What others do: Gemini groups declarations as tools: [{ functionDeclarations: [...] }] and some exports keep the declarations list alone; each declaration has the OpenAI name and parameters keys.

What to try, and why: the tool pre-pass reads Gemini function declarations, the convention the item names, because the item is the first failing one of level 1 and the source states the keyword is a partition of the input.

## Iteration 11

Question: packages/generate/src/extract/tools.ts: an optional property with a default gives no at-default partition, so schema-keywords.default loses it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 9.2 (default: the value that applies when the instance omits the property)
* packages/validators/src/ladders/map/bank/families/schema.ts (the default case and its convention)

What others do: schema-driven generators send an omitted optional property as its own input; with a default the omitted case is the default applying.

What to try, and why: the tool pre-pass adds at-default before absent for an optional property that states a default, because the item names that convention and the keyword states a distinct input class.

Also found and not fixed: schema-keywords.closed-object conflicts with styles.v1-precision. See HANDOVER.md.

## Iteration 12

Question: packages/generate/src/extract/tools.ts: locate knows tools, tool_schemas and functionDeclarations only, so a legacy { functions: [...] } file gives no tool; tool-formats.legacy-functions proves it.

Sources read:
* https://platform.openai.com/docs/api-reference/chat/create (the deprecated functions parameter: name, description, parameters)
* packages/validators/src/ladders/map/bank/families/formats.ts (legacy-functions)

What others do: The legacy functions list holds declarations with the same name and parameters keys as the tools form, at the root.

What to try, and why: the tool pre-pass reads the legacy OpenAI functions list

## Iteration 13

Question: packages/generate/src/extract/tools.ts: readTools reads a tool's schema at inputSchema and does not unwrap toolSpec, so a Bedrock file { toolSpec: { name, inputSchema: { json } } } gives no tool schema; tool-formats.bedrock proves it.

Sources read:
* https://docs.aws.amazon.com/bedrock/latest/userguide/tool-use-inference-call.html (toolSpec: name, description, inputSchema with a json key)
* packages/validators/src/ladders/map/bank/families/formats.ts (bedrock)

What others do: Bedrock Converse wraps each tool in toolSpec and the JSON Schema in inputSchema.json.

What to try, and why: the tool pre-pass reads Bedrock tool specs

## Iteration 14

Question: packages/generate/src/extract/tools.ts: firstMap takes parameters as the schema, so { parameters: { jsonSchema } } gives a schema with no properties; tool-formats.vercel-json-schema proves it.

Sources read:
* https://ai-sdk.dev/docs/reference/ai-sdk-core/json-schema (jsonSchema() wraps a JSON Schema for a tool's parameters)
* packages/validators/src/ladders/map/bank/families/formats.ts (vercel-json-schema)

What others do: The AI SDK wraps the JSON Schema of a tool in a jsonSchema value and keys tools by name.

What to try, and why: the tool pre-pass reads Vercel parameters wrapped as jsonSchema

## Iteration 15

Question: packages/generate/src/extract/tools.ts: locate looks at tools, tool_schemas, functionDeclarations, functions and metadata.tool_schemas, so an agent configuration holding agent.tools gives no tool; tool-formats.agent-config proves it.

Sources read:
* https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview (a tool is name, description, input_schema)
* packages/validators/src/ladders/map/bank/families/formats.ts (agent-config)

What others do: Agent frameworks keep tool definitions inside the agent block of their config, in the provider's own tool form.

What to try, and why: the tool pre-pass reads an agent configuration's tools under agent.tools

## Iteration 16

Question: packages/generate/src/extract/tools.ts: firstMap takes a mapping only, so parameters that are a JSON string give no schema; tool-formats.stringified-parameters proves it.

Sources read:
* https://platform.openai.com/docs/api-reference/chat/create (function arguments travel as JSON strings)
* packages/validators/src/ladders/map/bank/families/formats.ts (stringified-parameters)

What others do: Exports that keep a schema as a string parse it as JSON, which YAML reads as well; quotes then come from the string, which the file holds verbatim.

What to try, and why: the tool pre-pass reads parameters given as a JSON string

## Iteration 17

Question: packages/generate/src/extract/tools.ts: toolsPrepass parses one document, so a stream with --- between tools fails to parse; tool-formats.multi-document proves it.

Sources read:
* https://yaml.org/spec/1.2.2/ section 9.1 (a stream holds several documents)
* packages/validators/src/ladders/map/bank/families/formats.ts (multi-document)

What others do: A YAML stream is read document by document; one mapping per document is one tool, as in a list.

What to try, and why: the tool pre-pass reads a YAML stream with one tool per document

## Iteration 18

Question: packages/generate/src/extract/tools.ts: toolsPrepass fails to parse a file with // or block comments before or inside the JSON; tool-formats.jsonc proves it.

Sources read:
* https://code.visualstudio.com/docs/languages/json#_json-with-comments (JSONC allows // and block comments)
* packages/validators/src/ladders/map/bank/families/formats.ts (jsonc)

What others do: JSONC readers drop comments outside strings and parse the rest; blanking them keeps every position.

What to try, and why: the tool pre-pass reads JSON with comments

## Iteration 19

Question: packages/generate/src/extract/tools.ts: toolsPrepass parses the file as one document, so one JSON object per line fails to parse; tool-formats.jsonl proves it.

Sources read:
* https://jsonlines.org/ (one JSON value per line)
* packages/validators/src/ladders/map/bank/families/formats.ts (jsonl)

What others do: JSON Lines files hold one object per line; reading the lines as a list gives one tool each.

What to try, and why: the tool pre-pass reads JSON lines

## Iteration 20

Question: packages/generate/src/extract/tools.ts: readTools finds no input schema under parameter_definitions and typesOf does not know str, int, bool; tool-formats.cohere-v1 proves it.

Sources read:
* https://docs.cohere.com/v1/docs/tool-use (parameter_definitions: type, description, required)
* packages/validators/src/ladders/map/bank/families/formats.ts (cohere-v1)

What others do: Cohere v1 lists parameters by name with a short Python type and a required flag instead of a JSON Schema.

What to try, and why: the tool pre-pass reads Cohere parameter_definitions

## Iteration 21

Question: packages/generate/src/extract/tools.ts: locate and readTools know functionDeclarations in camel case only, so Vertex function_declarations gives no tool; tool-formats.vertex-snake-case proves it.

Sources read:
* https://cloud.google.com/vertex-ai/generative-ai/docs/multimodal/function-calling (REST field function_declarations)
* packages/validators/src/ladders/map/bank/families/formats.ts (vertex-snake-case)

What others do: Vertex REST uses snake case for the same structure Gemini SDKs write in camel case.

What to try, and why: the tool pre-pass reads Vertex function_declarations

## Iteration 22

Question: packages/generate/src/extract/tools.ts: readTools finds no input schema under args, so a tool with an args mapping of properties gives none; tool-formats.langchain-args proves it.

Sources read:
* https://python.langchain.com/docs/how_to/custom_tools/ (a tool's args schema maps argument names to their schema)
* packages/validators/src/ladders/map/bank/families/formats.ts (langchain-args)

What others do: LangChain tools expose args as a mapping from argument name to schema, with no required list, so each argument is optional.

What to try, and why: the tool pre-pass reads a LangChain args mapping

## Iteration 23

Question: packages/generate/src/extract/tools.ts: locate finds no tools in a document with paths, so an OpenAPI or Swagger file gives TOOLS_NOT_FOUND; tool-formats.openapi, swagger, openapi-components-ref and openapi-shared-path prove it.

Sources read:
* https://spec.openapis.org/oas/v3.0.3 (operation, requestBody, responses, components)
* https://swagger.io/specification/v2/ (body parameter, response schema, definitions)

What others do: OpenAPI generators and agent toolkits turn each operationId into one tool, the JSON body into its input and the 200 response into its output.

What to try, and why: the tool pre-pass reads OpenAPI 3 and Swagger 2 documents

## Iteration 24

Question: packages/generate/src/extract/tools.ts: readOpenApi takes the JSON request body as input only, so an operation whose inputs are query parameters has no input; tool-formats.openapi-query-parameters proves it.

Sources read:
* https://spec.openapis.org/oas/v3.0.3#parameter-object (in: query, name, required, schema)
* packages/validators/src/ladders/map/bank/families/formats.ts (openapi-query-parameters)

What others do: A GET operation takes its inputs as query parameters; each parameter is one argument with a schema and a required flag.

What to try, and why: the tool pre-pass reads OpenAPI query parameters

## Iteration 25

Question: packages/generate/src/extract/tools.ts: toolsPrepass reads YAML or JSON only, so an XML file of tool_description blocks fails to parse; tool-formats.xml-descriptions proves it.

Sources read:
* https://docs.anthropic.com/en/docs/build-with-claude/tool-use (the legacy XML tool_description format with tool_name and parameters)
* packages/validators/src/ladders/map/bank/families/formats.ts (xml-descriptions)

What others do: The legacy format names each parameter and its type and states no required flag, so each parameter has an absent case.

What to try, and why: the tool pre-pass reads legacy XML tool descriptions

## Iteration 26

Question: packages/generate/src/extract/tools.ts: toolsPrepass reads YAML or JSON only, so a TOML file fails to parse; tool-formats.toml proves it.

Sources read:
* https://toml.io/en/v1.0.0 (tables and arrays of tables)
* https://github.com/squirrelchat/smol-toml (maintained TOML 1.0 parser)

What others do: Tool configs in TOML are read by a TOML parser into the same data; quotes stay lines of the file.

What to try, and why: the tool pre-pass reads TOML

## Iteration 27

Question: packages/generate/src/extract/tools.ts: quoter returns the whole keyword line, so a pattern line over 1000 characters gives a quote over the limit and an invalid proposal; schema-keywords.long-pattern proves it.

Sources read:
* packages/generate/src/extract/proposal.ts (a quote is at most 1000 characters)
* packages/validators/src/ladders/map/bank/families/schema.ts (long-pattern)

What others do: A quote is a passage of the file; a prefix of a long line is still a passage.

What to try, and why: a quote of a very long pattern stays within 1000 characters

## Iteration 28

Question: packages/generate/src/extract/tools.ts: propertySlug replaces every character outside a-z, 0-9, underscore and hyphen, so user.email becomes user_email and $ref becomes _ref; adversarial.property-name-with-dot and property-named-ref prove it.

Sources read:
* packages/validators/src/ladders/map/bank/families/adversarial.ts (the two items)
* https://json-schema.org/draft/2020-12/json-schema-core (a property name is any string)

What others do: A dimension id keeps the property name as written so a spec can name it back.

What to try, and why: a property name keeps its dot and dollar sign

## Iteration 29

Question: packages/generate/src/extract/prepass.ts: itemText falls back to the whole title line, so a title over 1000 characters gives an invalid proposal; inventory-forms.long-item and long-flow-title prove it.

Sources read:
* packages/generate/src/extract/proposal.ts (a quote is at most 1000 characters)
* packages/validators/src/ladders/map/bank/families/inventory.ts (long-item)

What others do: A prefix of a long line is still a passage of the file.

What to try, and why: a title line over 1000 characters is quoted by its first passage

## Iteration 30

Question: packages/generate/src/extract/extract.ts: the inventory is parsed as YAML or JSON only, so a markdown-table or CSV inventory gives INVENTORY_PARSE; inventory-forms.markdown-tables and csv prove it.

Sources read:
* https://spec.commonmark.org/ and https://github.github.com/gfm/#tables-extension- (pipe tables)
* https://www.rfc-editor.org/rfc/rfc4180 (CSV)

What others do: Tables are read into the same mapping an inventory holds, and each quote is the row of the table it came from.

What to try, and why: an inventory kept as markdown tables or CSV is read

## Iteration 31

Question: packages/generate/src/extract/tools.ts: partitionsOf reads no composition keyword, so a property made of oneOf, anyOf or allOf gives no partition; schema-keywords.one-of, any-of, any-of-null, all-of, one-of-consts, discriminator and all-of-required prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 10.2 (applicators: allOf, anyOf, oneOf)
* https://spec.openapis.org/oas/v3.0.3#discriminator-object

What others do: Each branch of a oneOf or anyOf is a case; allOf is the conjunction, so its members' partitions all apply.

What to try, and why: the tool pre-pass reads oneOf, anyOf and allOf

## Iteration 32

Question: packages/generate/src/extract/tools.ts: walk follows object properties to depth two and ignores array items, so depth-three, array-of-objects, array-items-enum, prefix-items, tuple-items-draft-04, items-ref and recursive-ref lose their partitions.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 10.3.1 (prefixItems, items)
* https://json-schema.org/draft/2020-12/json-schema-core section 8.2.3 ($ref and recursion)

What others do: Array items are a schema of their own; tuples give one schema per position; a recursive reference is read once.

What to try, and why: the tool pre-pass follows arrays, tuples and nesting

## Iteration 33

Question: packages/generate/src/extract/tools.ts: partitionsOf reads none of these leaf keywords, so const-object, enum-objects, contains, min-contains, not, property-names, content-media-type, format-int32 and x-nullable lose their values.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation sections 6.4.4 (contains), 8.3 (contentMediaType), 7.3 (format)
* https://swagger.io/specification/v2/ (x-nullable vendor extension)

What others do: Each keyword states an input class a generator tests on its own.

What to try, and why: the tool pre-pass reads object consts, contains, not, propertyNames, contentMediaType, int32 and x-nullable

## Iteration 34

Question: packages/generate/src/extract/tools.ts: walk reads named properties only, so the keys an object accepts beyond them give no case; unevaluated-properties, additional-properties-schema and pattern-properties prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core sections 10.3.2 (additionalProperties, patternProperties) and 11.3 (unevaluatedProperties)

What others do: A generator sends one extra key the schema forbids, and a typed and a mistyped extra key where a schema is given.

What to try, and why: the tool pre-pass reads unevaluatedProperties, additionalProperties schemas and patternProperties

## Iteration 35

Question: packages/generate/src/extract/tools.ts: walk reads no dependency keyword, so a property that needs another gives no present-without case; schema-keywords.dependent-required, dependencies and dependent-schemas prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 6.5.4 (dependentRequired)
* https://json-schema.org/draft/2020-12/json-schema-core section 10.2.2.4 (dependentSchemas)

What others do: A dependency is a rule a test breaks by giving the property without the one it needs.

What to try, and why: the tool pre-pass reads property dependencies

## Iteration 36

Question: packages/generate/src/extract/tools.ts: walk gives a dimension to every property, so a readOnly input, a writeOnly output and a deprecated property gain cases nobody exercises; schema-keywords.read-only-input, write-only-output and deprecated-property prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 9.4 (readOnly, writeOnly, deprecated)

What others do: A readOnly property is set by the server, a writeOnly one is never returned, a deprecated one is retired.

What to try, and why: the tool pre-pass leaves out readOnly inputs, writeOnly outputs and deprecated properties

## Iteration 37

Question: packages/generate/src/extract/tools.ts: a readOnly output property and a writeOnly input property that the schema does not list as required gain an absent case, though the side that sets them always gives them; schema-keywords.read-only-input and write-only-output prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-validation section 9.4 (readOnly, writeOnly)

What others do: The server always returns a readOnly value, and a caller always gives a writeOnly one when it sets it.

What to try, and why: a readOnly output and a writeOnly input have no absent case

## Iteration 38

Question: packages/generate/src/extract/tools.ts: objectCases reads no conditional, so an if with then or else gives no case; schema-keywords.if-then-else proves it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 10.2.2 (if, then, else)

What others do: A conditional has two branches; a test takes each.

What to try, and why: the tool pre-pass reads if, then and else

## Iteration 39

Question: packages/generate/src/extract/tools.ts: resolveRef drops the keywords written beside a $ref and knows JSON pointers only; schema-keywords.ref-with-siblings and ref-anchor prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 8.2.3.1 ($ref beside other keywords) and 8.2.2 ($anchor)

What others do: In 2020-12 a $ref is an applicator beside the other keywords, and an anchor names a subschema.

What to try, and why: the tool pre-pass reads keywords beside a $ref and a $ref to an $anchor

## Iteration 40

Question: packages/generate/src/extract/tools.ts: field reads the branches of a oneOf only as variants, never their properties; schema-keywords.one-of-object-children proves it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 10.2.1.3 (oneOf)

What others do: Each branch is an object of its own; its properties are cases under the variant.

What to try, and why: the tool pre-pass follows the properties of oneOf object branches

## Iteration 41

Question: packages/generate/src/extract/extract.ts: a request sends a JSON chat file or agent export as the file's text, so a rule with an escaped quote or newline is not visible as written; prompt-containers.json-messages, json-ascii, json-prompt-key and jsonl prove it.

Sources read:
* https://www.rfc-editor.org/rfc/rfc8259 section 7 (string escapes)
* https://jsonlines.org/

What others do: A model reads the prompt, not the escapes; a decoded quote is still a passage of the prompt.

What to try, and why: a request shows the prompt decoded from a JSON file

## Iteration 42

Question: packages/generate/src/extract/extract.ts: the extractor accepts a model quote only as written in the file, but a model quotes the decoded prompt, so a rule with an escape gives PROPOSAL_QUOTE_NOT_FOUND; prompt-containers.json-messages, json-ascii, json-prompt-key and jsonl prove it. Iteration 41 showed the decoded view alone is not enough.

Sources read:
* https://www.rfc-editor.org/rfc/rfc8259 section 7 (string escapes)
* packages/validators/src/ladders/map/bank/run.ts (quotes are checked against the file as written)

What others do: A model reads the decoded prompt; the proposal must quote the file, so each quote is mapped through a character table back to the file passage.

What to try, and why: a quote from a decoded JSON prompt is mapped back to the file

## Iteration 43

Question: packages/generate/src/extract/containers.ts: a quote mapped to the raw file keeps escapes the prompt does not hold, so it leaves the rule's text; prompt-containers.json-messages, json-ascii, json-prompt-key and jsonl prove it.

Sources read:
* packages/validators/src/ladders/map/bank/facts.ts (a quote lies inside the rule and inside the file)
* https://www.rfc-editor.org/rfc/rfc8259 section 7

What others do: A quote must be a passage of the file and of the prompt; the passage without escapes is both.

What to try, and why: a decoded quote keeps the longest passage the file writes as it is

## Iteration 44

Question: packages/generate/src/extract/containers.ts: a YAML double-quoted scalar with escapes or a single-quoted one with doubled apostrophes is sent as written; prompt-containers.yaml-double and yaml-single prove it.

Sources read:
* https://yaml.org/spec/1.2.2/ sections 7.3.1 (double-quoted) and 7.3.2 (single-quoted)

What others do: The scalar's value is the prompt; the file's escapes are not.

What to try, and why: quoted YAML scalars are decoded

## Iteration 45

Question: packages/generate/src/extract/containers.ts: a prompt in a single-quoted TypeScript, PHP or JSON5 string or a Go interpreted string is sent with its backslash escapes; prompt-containers.ts-single, php-single, json5 and go-interpreted prove it.

Sources read:
* https://262.ecma-international.org/ section 12.9.4 (string literals)
* https://www.php.net/manual/en/language.types.string.php (single quoted)
* https://go.dev/ref/spec#String_literals

What others do: The string's value is the prompt; the language's escapes are not.

What to try, and why: string literals in code are decoded

## Iteration 46

Question: packages/generate/src/extract/containers.ts: a rule cut across two string literals joined with + or implicit concatenation is sent as two pieces with code between them; prompt-containers.ts-concat and python-concat prove it.

Sources read:
* https://262.ecma-international.org/ (string concatenation)
* https://docs.python.org/3/reference/lexical_analysis.html#string-literal-concatenation

What others do: Adjacent literals are one string; a quote must still be one passage of the file.

What to try, and why: string literals joined in code read as one string

## Iteration 47

Question: packages/generate/src/extract/containers.ts: a rule with ${NAME} or {NAME} in a template literal or f-string is sent with the name, so the text the model reads lacks the rule as the prompt states it; prompt-containers.ts-template and python-fstring prove it.

Sources read:
* https://262.ecma-international.org/ section 13.2.8 (template literals)
* https://docs.python.org/3/reference/lexical_analysis.html#f-strings

What others do: A template's value has the constant in place; the model reads that.

What to try, and why: constants interpolated in a template are replaced by their value

## Iteration 48

Question: packages/generate/src/extract/containers.ts: the doubled quote of a C# verbatim string and of an SQL string is sent as two characters; prompt-containers.csharp-verbatim and sql-string prove it.

Sources read:
* https://learn.microsoft.com/en-us/dotnet/csharp/language-reference/tokens/verbatim
* https://www.postgresql.org/docs/current/sql-syntax-lexical.html#SQL-SYNTAX-STRINGS

What others do: In both, a doubled quote inside the literal stands for one.

What to try, and why: doubled quotes in C# verbatim and SQL strings are one quote

## Iteration 49

Question: packages/generate/src/extract/containers.ts: HTML and XML prompts are sent with entities (&amp; &quot; &#10; &#8217;), inline tags and <br> as written; prompt-containers.html-entities, html-inline-tags, html-line-breaks, xml-escaped and xml-attribute prove it.

Sources read:
* https://html.spec.whatwg.org/multipage/syntax.html#character-references
* https://www.w3.org/TR/xml/#sec-predefined-ent

What others do: A reader of a page sees its text: entities decoded, tags gone, a break where a <br> sits.

What to try, and why: markup entities and tags are decoded

## Iteration 50

Question: packages/generate/src/extract/containers.ts: a TOML basic string and a double-quoted environment value are sent with their backslash escapes; prompt-containers.toml-basic and env-file prove it.

Sources read:
* https://toml.io/en/v1.0.0#string
* https://12factor.net/config and dotenv quoting rules

What others do: A basic string and a quoted env value use the escapes of JSON strings.

What to try, and why: double-quoted values in TOML and environment files are decoded

## Iteration 51

Question: packages/generate/src/extract/containers.ts: a properties value is sent with its \n escapes and backslash line continuations; prompt-containers.properties proves it.

Sources read:
* https://docs.oracle.com/javase/8/docs/api/java/util/Properties.html#load-java.io.Reader- (escapes and line continuation)

What others do: A backslash at the end of a line continues the value; the next line's leading white space is dropped.

What to try, and why: Java properties escapes and continuations are decoded

## Iteration 52

Question: packages/generate/src/extract/containers.ts: a quoted CSV cell is sent with its doubled quotes; prompt-containers.csv proves it.

Sources read:
* https://www.rfc-editor.org/rfc/rfc4180 section 2 rule 7

What others do: Inside a quoted field, a double quote is written twice.

What to try, and why: doubled quotes in CSV cells are one quote

## Iteration 53

Question: packages/generate/src/extract/containers.ts: a Swift multi-line string is sent with \(NAME) as written; prompt-containers.swift-interpolation proves it.

Sources read:
* https://docs.swift.org/swift-book/documentation/the-swift-programming-language/stringsandcharacters/ (multiline strings, string interpolation)

What others do: The interpolated constant has its value in the string the program builds.

What to try, and why: Swift multi-line strings with an interpolated constant are decoded

## Iteration 54

Question: packages/generate/src/extract/containers.ts: a chat message whose content is a list of text parts is sent with a break between the parts and with its role and part type as text; a rule cut across two parts is not one passage; prompt-containers.content-parts proves it.

Sources read:
* https://platform.openai.com/docs/api-reference/chat/create (content parts of type text)
* https://docs.anthropic.com/en/api/messages (content blocks)

What others do: A message's parts are one text; labels such as role and type are not prompt text.

What to try, and why: the parts of a JSON message run on as one text

## Iteration 55

Question: packages/generate/src/extract/containers.ts: the XML of a Word document is sent with each paragraph split into runs of tags; prompt-containers.docx-runs proves it.

Sources read:
* https://learn.microsoft.com/en-us/office/open-xml/word/structure-of-a-wordprocessingml-document (paragraphs hold runs, runs hold text)

What others do: A paragraph's text is its runs joined; the tags between them are not text.

What to try, and why: the runs of a Word document read as one paragraph

## Iteration 56

Question: packages/generate/src/extract/containers.ts: a .rst file is sent with backslash escapes and a .tex file with its \textbf{} wrappers as written; prompt-containers.restructured-text and latex prove it.

Sources read:
* https://docutils.sourceforge.io/docs/ref/rst/restructuredtext.html#escaping-mechanism
* https://www.latex-project.org/help/documentation/usrguide.pdf (commands with arguments)

What others do: In reST a backslash escapes the next character; in LaTeX a command with one braced argument displays the argument.

What to try, and why: reStructuredText escapes and LaTeX commands are decoded (level 1 is blocked on validator defects, so the level stays 0)

## Iteration 57

Question: packages/generate/src/extract/contract.ts: the answer template shows no polarity key and the proposal keeps none, so the polarity of every rule is lost; contract:rule-polarity (styles, style-pairs, semantics) proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (must or must not)
* packages/validators/src/ladders/map/bank/perfect.ts (a model writes only keys the template shows)

What others do: The template lists the keys a model may write; a key it does not list is dropped.

What to try, and why: a rule records its polarity (level 1 is blocked on validator defects, so the level stays 0)

## Iteration 58

Question: packages/generate/src/extract/contract.ts: the answer template shows no when key on a value, so the cell a rule applies in is lost; contract:rule-when (styles, style-pairs, semantics) proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (the cell it applies in)

What others do: A model writes only the keys the template lists.

What to try, and why: a rule records the cell it applies in (when; level 1 is blocked on validator defects, so the level stays 0)

## Iteration 59

Question: packages/generate/src/extract/contract.ts: the answer template shows no unless key on a value; contract:rule-unless proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (unless)

What others do: A model writes only the keys the template lists.

What to try, and why: a rule records the case it excludes (unless)

## Iteration 60

Question: packages/generate/src/extract/contract.ts: the answer template shows no limit key on a value; contract:rule-limit proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (a count limit)

What others do: A model writes only the keys the template lists.

What to try, and why: a rule records a count limit

## Iteration 61

Question: packages/generate/src/extract/contract.ts: the answer template shows no within key on a value; contract:rule-within proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (a time limit)

What others do: A model writes only the keys the template lists.

What to try, and why: a rule records a time limit

## Iteration 62

Question: packages/generate/src/extract/contract.ts: the answer template shows no priority key on a value; contract:rule-priority proves it.

Sources read:
* docs/generating.md section Planned: what a rule states (that it comes first)

What others do: A model writes only the keys the template lists.

What to try, and why: a rule records that it comes first

## Iteration 63

Question: packages/generate/src/extract/contract.ts: the answer template shows no weight key on a value; contract:value-weight proves it.

Sources read:
* docs/generating.md section Planned: what a value states (the share of users it stands for)

What others do: A model writes only the keys the template lists.

What to try, and why: a value records the share of users it stands for

## Iteration 64

Question: packages/generate/src/extract/contract.ts: the answer template shows no required key on a value; contract:value-required proves it.

Sources read:
* docs/generating.md section Planned: what a value states (that a test plan must include it)

What others do: A model writes only the keys the template lists.

What to try, and why: a value records that a test plan must include it

## Iteration 65

Question: packages/generate/src/extract/tools.ts: propertySlug keeps a dot, but the updated item adr.property-name-with-dot expects user_email; the item proves it.

Sources read:
* packages/validators/src/ladders/map/bank/families/adversarial.ts (updated by PR 90)

What others do: A dot in a dimension id reads as a path; the item wants one field.

What to try, and why: a dot in a property name becomes an underscore (the item now says one field, not a path)

## Iteration 66

Question: packages/generate/src/extract/tools.ts: additionalProperties false on an input gives no case; schema-keywords.closed-object proves it (PR 90 fixed the contradiction with v1-precision).

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 10.3.2.3

What others do: A closed object rejects an unknown key; a test sends one.

What to try, and why: a closed input gives an unknown-key case

## Iteration 67

Question: packages/generate/src/extract/tools.ts: unevaluatedItems false and additionalItems false give no extra-item; schema-keywords.unevaluated-items and additional-items prove it.

Sources read:
* https://json-schema.org/draft/2020-12/json-schema-core section 11.2

What others do: A closed tuple rejects an item past its positions.

What to try, and why: a closed tuple gives an extra-item case

## Iteration 68

Question: packages/generate/src/extract/contract.ts: the answer template shows no role key on a dimension, so a declared axis or detail is lost and the first dimension of a kind stays the axis; contract:dimension-role (roles, transforms) proves it.

Sources read:
* docs/generating.md section Planned: declared roles

What others do: A model writes only the keys the template lists.

What to try, and why: a dimension records the role a source declares

## Iteration 69

Question: packages/generate/src/extract/proposal.ts: no relation kind states the order of two tools, so a stated order is lost; contract:relation-tool-order (semantics.tool-order) proves it.

Sources read:
* docs/generating.md section Planned: more relations (the order two tools are called in)

What others do: A relation kind not in the proposal schema is refused.

What to try, and why: the relation kind tool_order

## Iteration 70

Question: packages/generate/src/extract/proposal.ts: no relation kind sends a topic to a team, so a routing rule is lost; contract:relation-route (semantics.route) proves it.

Sources read:
* docs/generating.md section Planned: more relations (the route a request takes)

What others do: A relation kind not in the proposal schema is refused.

What to try, and why: the relation kind route

## Iteration 71

Question: packages/generate/src/extract/proposal.ts: no relation kind fixes the exact words of a reply, so such a rule is lost; contract:relation-reply-text (semantics.reply-text) proves it.

Sources read:
* docs/generating.md section Planned: more relations (the exact reply text a rule fixes)

What others do: A relation kind not in the proposal schema is refused.

What to try, and why: the relation kind reply_text

## Iteration 72

Question: packages/generate/src/extract/proposal.ts: the reply_text relation was defined but not added to the relation union, so it was still refused; contract:relation-reply-text (semantics.reply-text) proves it. Red proof: the reply_text test failed on the committed iteration 71.

Sources read:
* docs/generating.md section Planned: more relations (the exact reply text a rule fixes)

What others do: A relation kind outside the union is refused.

What to try, and why: the relation kind reply_text, completed (iteration 71 left it out of the union)

## Iteration 73

Question: packages/generate/src/extract/quote.ts: foldQuote keeps decomposed accents, zero-width characters and markdown backslashes, so a model quote that differs only by them is refused; hostile-inputs.decomposed-accents, zero-width-space, soft-hyphen, direction-mark and markdown-escapes prove it. One mechanism, five items.

Sources read:
* https://unicode.org/reports/tr15/ (normalization forms)
* https://spec.commonmark.org/0.31.2/#backslash-escapes

What others do: A quote check that is strict about bytes refuses a faithful copy.

What to try, and why: quote folding ignores accent form, invisible characters and markdown escapes

## Iteration 74

Question: packages/generate/src/extract/extract.ts: one request carries the whole prompt, so an answer for a 100k character prompt is cut at the output limit and the section fails; scale.100k.* (28 items) prove it.

Sources read:
* docs/generating.md section Planned: long prompts
* packages/validators/src/ladders/map/bank/perfect.ts (output limit 16000 tokens)

What others do: A prompt over 40000 characters is cut in chunks of 12000 at line boundaries; the answers are merged by the draft.

What to try, and why: a long prompt is read in chunks

## Iteration 75

Question: packages/generate/src/extract/chunks.ts: a chunk after the first starts mid-section or mid-table, so its rules lose their heading scope and its table rows lose their column header; scale.chunk.heading-path, table-header, deprecated-marker and the table and nested scale items prove it.

Sources read:
* docs/generating.md section Planned: long prompts (a table with its header, a section with its heading path, a deprecation marker)

What others do: Context lines are lines of the file, so quotes from them stay found.

What to try, and why: a chunk carries the headings and the table header it sits under

## Iteration 76

Question: packages/generate/src/extract/chunks.ts: an update at the end of a long prompt that says an earlier rule no longer holds is in a later chunk than the rule, so the rule is reported live; scale.chunk.replacements and the precedence scale items prove it.

Sources read:
* docs/generating.md section Planned: long prompts (a replacement in one chunk retires the rule it replaces in another)

What others do: Update lines are lines of the file; a chunk that carries them lets the reader see the replacement.

What to try, and why: every chunk carries the updates that retire earlier rules

## Iteration 77

Question: packages/generate/src/extract/chunks.ts: iteration 76 carried whole update lines, so every chunk also reported the replacing rules and its answer was cut at the limit; scale.chunk.replacements proves it.

Sources read:
* docs/generating.md section Planned: long prompts

What others do: The replacement is read once, in its own chunk; others carry only the retiring clause.

What to try, and why: a chunk carries only the clause of an update that retires a rule

## Iteration 78

Question: packages/generate/src/extract/chunks.ts: a cut can fall between a question and the line that answers it; scale.chunk.question-answer proves it.

Sources read:
* docs/generating.md section Planned: long prompts (a question with its answer)

What others do: A cut that would end a chunk on a question moves before it.

What to try, and why: a chunk never ends on a question

## Iteration 79

Question: packages/generate/src/extract/contract.ts: the already-proposed list names every value, so a 1M character prompt with 9000 rules gives a request over the context window and later sections fail; scale.1m.markdown and table+negation prove it.

Sources read:
* packages/validators/src/ladders/map/bank/perfect.ts (context 200000 tokens)

What others do: A repeated value is ignored by the draft, so the list need not name every value.

What to try, and why: a request lists a long dimension in part
