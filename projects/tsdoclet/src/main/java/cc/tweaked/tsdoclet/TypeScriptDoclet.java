// SPDX-FileCopyrightText: 2026 average-web-dev
//
// SPDX-License-Identifier: MPL-2.0

package cc.tweaked.tsdoclet;

import com.sun.source.doctree.DocCommentTree;
import com.sun.source.doctree.DocTree;
import com.sun.source.doctree.UnknownBlockTagTree;
import com.sun.source.util.DocTrees;
import jdk.javadoc.doclet.Doclet;
import jdk.javadoc.doclet.DocletEnvironment;
import jdk.javadoc.doclet.Reporter;

import javax.lang.model.SourceVersion;
import javax.lang.model.element.AnnotationMirror;
import javax.lang.model.element.Element;
import javax.lang.model.element.ElementKind;
import javax.lang.model.element.ExecutableElement;
import javax.lang.model.element.TypeElement;
import javax.lang.model.element.VariableElement;
import javax.lang.model.type.ArrayType;
import javax.lang.model.type.DeclaredType;
import javax.lang.model.type.TypeMirror;
import javax.lang.model.util.ElementFilter;
import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;

/**
 * A javadoc {@link Doclet} which emits a TypeScript {@code .d.ts} declaration for every type with
 * {@code @ScriptFunction} methods — the TS analogue of CC's {@code LuaDoclet}.
 *
 * <p>The TS signature is derived from the Java method signature (numbers, strings, booleans, arrays,
 * {@code Optional}, …). Where the Java type is opaque (an {@code Object} return after the single-value
 * migration), the type is taken from an explicit {@code @cc-r.return <type>} block tag.
 */
public class TypeScriptDoclet implements Doclet {
    private Reporter reporter;
    private Path outputDir = Path.of("build/tsTypes");
    /** Records referenced by a script method (return/parameter types); emitted as TS interfaces. */
    private final java.util.Set<TypeElement> referencedRecords = new java.util.LinkedHashSet<>();
    private final java.util.Set<TypeElement> referencedEnums = new java.util.LinkedHashSet<>();

    @Override
    public void init(Locale locale, Reporter reporter) {
        this.reporter = reporter;
    }

    @Override
    public String getName() {
        return "TypeScript";
    }

    @Override
    public SourceVersion getSupportedSourceVersion() {
        return SourceVersion.latest();
    }

    @Override
    public Set<? extends Option> getSupportedOptions() {
        Option output = new BasicOption(1, List.of("-d", "--output-directory")) {
            @Override
            public boolean process(String option, List<String> arguments) {
                outputDir = Path.of(arguments.get(0));
                return true;
            }
        };
        // Accept (and ignore) the standard-doclet flags Gradle's Javadoc task always emits.
        return Set.of(
            output,
            new BasicOption(1, List.of("-windowtitle")),
            new BasicOption(1, List.of("-doctitle")),
            new BasicOption(1, List.of("-header")),
            new BasicOption(1, List.of("-footer")),
            new BasicOption(1, List.of("-bottom")),
            new BasicOption(1, List.of("-charset")),
            new BasicOption(1, List.of("-docencoding")),
            new BasicOption(1, List.of("-encoding")),
            new BasicOption(0, List.of("-notimestamp")),
            new BasicOption(0, List.of("-use")),
            new BasicOption(0, List.of("-author")),
            new BasicOption(0, List.of("-version")));
    }

    /** An {@link Option} that accepts a fixed number of arguments and, by default, ignores them. */
    private static class BasicOption implements Option {
        private final int args;
        private final List<String> names;

        BasicOption(int args, List<String> names) {
            this.args = args;
            this.names = names;
        }

        @Override
        public int getArgumentCount() {
            return args;
        }

        @Override
        public String getDescription() {
            return "";
        }

        @Override
        public Kind getKind() {
            return Kind.STANDARD;
        }

        @Override
        public List<String> getNames() {
            return names;
        }

        @Override
        public String getParameters() {
            return "";
        }

        @Override
        public boolean process(String option, List<String> arguments) {
            return true;
        }
    }

    @Override
    public boolean run(DocletEnvironment env) {
        var docTrees = env.getDocTrees();
        try {
            Files.createDirectories(outputDir);
            // The base every peripheral interface extends. IPeripheral itself has no @ScriptFunction
            // methods, so it is not discovered by scanning — emit a fixed base here.
            Files.writeString(outputDir.resolve("IPeripheral.d.ts"),
                "interface IPeripheral {\n    type: string;\n}\n");
            for (var type : ElementFilter.typesIn(env.getIncludedElements())) {
                emitType(type, docTrees);
            }
            emitEventMap(env);
            // Force-emit any record/enum explicitly marked `@cc-r.interface`, even if nothing references it
            // (e.g. a shape returned only through an opaque Object / @cc-r.return, or used purely in TS).
            // Records are commonly nested inside an API class, so recurse into enclosed types too.
            var allTypes = new ArrayList<TypeElement>();
            for (var type : ElementFilter.typesIn(env.getIncludedElements())) collectNestedTypes(type, allTypes);
            for (var type : allTypes) {
                if (blockTags(docTrees.getDocCommentTree(type), "cc-r.interface").isEmpty()) continue;
                if (type.getKind() == ElementKind.RECORD) referencedRecords.add(type);
                else if (type.getKind() == ElementKind.ENUM) referencedEnums.add(type);
            }
            // Emit an interface for each referenced record (and any records they reference, transitively).
            var emitted = new java.util.HashSet<String>();
            for (boolean more = true; more; ) {
                more = false;
                for (var rec : List.copyOf(referencedRecords)) {
                    if (emitted.add(rec.getSimpleName().toString())) {
                        emitRecord(rec, docTrees);
                        more = true;
                    }
                }
            }
            for (var en : referencedEnums) emitEnum(en);
        } catch (IOException e) {
            reporter.print(javax.tools.Diagnostic.Kind.ERROR, "Cannot write .d.ts: " + e.getMessage());
            return false;
        }
        return true;
    }

    private void emitType(TypeElement type, DocTrees docTrees) throws IOException {
        // Only `@cc.module` types are entry points. Base classes and method mixins (RedstoneMethods,
        // AbstractHandle, …) get no file of their own — their methods are folded into the module that
        // exposes them by the hierarchy walk below.
        var module = blockTagText(docTrees.getDocCommentTree(type), "cc.module");
        if (module == null) return;
        module = module.trim();

        // Gather @ScriptFunction methods from this type and everything it inherits (superclasses +
        // interfaces), most-derived first so an override wins and a method is emitted only once.
        var methods = new ArrayList<ExecutableElement>();
        collectScriptMethods(type, new java.util.HashSet<>(), methods);

        var body = new ArrayList<String>();
        for (var method : methods) body.addAll(renderMethod(method, docTrees));
        if (body.isEmpty()) return; // nothing scriptable here

        var isPeripheral = isAssignableTo(type, "IPeripheral");
        var name = type.getSimpleName().toString();

        // Ambient global declaration (no export/import) so it merges with the hand-written .d.ts files.
        var out = new StringBuilder("interface ").append(name);
        if (isPeripheral) out.append(" extends IPeripheral");
        out.append(" {\n");
        if (isPeripheral) out.append("    type: '").append(module).append("';\n");
        for (var line : body) out.append("    ").append(line).append("\n");
        out.append("}\n");

        // A non-peripheral API tagged `@cc.module <id>` is loadable via require(): emit its overload
        // plus an ambient `declare module` (so `import x = require("x")` / `import * as x` also resolve)
        // alongside the interface. Skip peripherals and GenericPeripheral method mixins (attached/
        // wrapped, not required), sub-handles like `fs.ReadHandle`, and `[kind=…]` event modules —
        // only a bare lowercase id (no dot, no bracket) on a standalone API names a require-able module.
        if (!isPeripheral && !isAssignableTo(type, "GenericPeripheral") && module.matches("[a-z_]+")) {
            out.append("declare function require(id: \"").append(module).append("\"): ").append(name).append(";\n");
            // `module` matches [a-z_]+, so it is a valid JS identifier for the const binding.
            out.append("declare module \"").append(module).append("\" { const ").append(module)
                .append(": ").append(name).append("; export = ").append(module).append("; }\n");
        }

        Files.writeString(outputDir.resolve(name + ".d.ts"), out.toString());
    }

    /**
     * Collect every {@code @ScriptFunction} method of {@code type}, walking up its superclass chain and
     * implemented interfaces. {@code seen} holds the exposed script names already taken; because the most
     * derived type is visited first, an override shadows the inherited declaration.
     */
    private void collectScriptMethods(TypeElement type, java.util.Set<String> seen, List<ExecutableElement> out) {
        for (var method : ElementFilter.methodsIn(type.getEnclosedElements())) {
            if (!hasAnnotation(method.getAnnotationMirrors(), "ScriptFunction")) continue;
            var names = scriptFunctionNames(method);
            if (names.stream().anyMatch(seen::contains)) continue; // already provided by a more-derived type
            seen.addAll(names);
            out.add(method);
        }
        for (var supertype : supertypes(type)) collectScriptMethods(supertype, seen, out);
    }

    /** A type and every type nested within it (transitively). */
    private void collectNestedTypes(TypeElement type, List<TypeElement> out) {
        out.add(type);
        for (var nested : ElementFilter.typesIn(type.getEnclosedElements())) collectNestedTypes(nested, out);
    }

    /** The directly-extended class (unless {@code Object}/{@code Record}) and implemented interfaces, as elements. */
    private List<TypeElement> supertypes(TypeElement type) {
        var out = new ArrayList<TypeElement>();
        var sup = type.getSuperclass();
        if (sup instanceof DeclaredType d && d.asElement() instanceof TypeElement se
            && !se.getQualifiedName().contentEquals("java.lang.Object")
            && !se.getQualifiedName().contentEquals("java.lang.Record")) {
            out.add(se);
        }
        for (var iface : type.getInterfaces()) {
            if (iface instanceof DeclaredType d && d.asElement() instanceof TypeElement ie) out.add(ie);
        }
        return out;
    }

    /** Build {@code EventMap.ts} from every {@code @Event} record: name → labelled tuple of components. */
    private void emitEventMap(DocletEnvironment env) throws IOException {
        var events = new java.util.TreeMap<String, String>();
        for (var type : ElementFilter.typesIn(env.getIncludedElements())) {
            var event = eventName(type);
            if (event == null || type.getKind() != ElementKind.RECORD) continue;
            var tuple = new StringBuilder("[");
            var first = true;
            for (var comp : type.getRecordComponents()) {
                if (!first) tuple.append(", ");
                first = false;
                tuple.append(comp.getSimpleName()).append(": ").append(tsType(comp.asType()));
            }
            events.put(event, tuple.append("]").toString());
        }
        if (events.isEmpty()) return;

        var out = new StringBuilder("interface EventMap {\n");
        for (var e : events.entrySet()) out.append("    ").append(e.getKey()).append(": ").append(e.getValue()).append(";\n");
        out.append("}\n");
        Files.writeString(outputDir.resolve("EventMap.d.ts"), out.toString());
    }

    /** The name from a record's {@code @Event("…")} annotation, or {@code null} if absent. */
    private String eventName(TypeElement type) {
        for (var am : type.getAnnotationMirrors()) {
            if (!simpleName(am.getAnnotationType()).equals("Event")) continue;
            for (var entry : am.getElementValues().entrySet()) {
                if (entry.getKey().getSimpleName().contentEquals("value")) return entry.getValue().getValue().toString();
            }
        }
        return null;
    }

    /** Emit a TS interface for a record, one field per record component. */
    private void emitRecord(TypeElement rec, DocTrees docTrees) throws IOException {
        var name = rec.getSimpleName().toString();
        var out = new StringBuilder();
        var summary = firstSentence(docTrees.getDocCommentTree(rec));
        if (summary != null) out.append("/** ").append(summary).append(" */\n");
        out.append("interface ").append(name).append(" {\n");
        for (var comp : rec.getRecordComponents()) {
            var type = tsType(comp.asType());
            if (isNullableComponent(comp) && !type.contains("null")) type += " | null";
            out.append("    ").append(comp.getSimpleName()).append(": ").append(type).append(";\n");
        }
        out.append("}\n");
        Files.writeString(outputDir.resolve(name + ".d.ts"), out.toString());
    }

    /** Emit a TS string-union type alias for an enum, using the lowercased constant names (CC's wire form). */
    private void emitEnum(TypeElement en) throws IOException {
        var name = en.getSimpleName().toString();
        var values = new ArrayList<String>();
        for (var c : en.getEnclosedElements()) {
            if (c.getKind() == ElementKind.ENUM_CONSTANT) {
                values.add("\"" + c.getSimpleName().toString().toLowerCase(java.util.Locale.ROOT) + "\"");
            }
        }
        var out = "type " + name + " = " + String.join(" | ", values) + ";\n";
        Files.writeString(outputDir.resolve(name + ".d.ts"), out);
    }

    /** Render the declarations for one method — one per exposed name (annotation aliases). */
    private List<String> renderMethod(ExecutableElement method, DocTrees docTrees) {
        var doc = docTrees.getDocCommentTree(method);

        // `@cc-r.eventlistener` — emit a generic listener over EventMap plus a string fallback overload.
        if (!blockTags(doc, "cc-r.eventlistener").isEmpty()) {
            var lines = new ArrayList<String>();
            var sum = firstSentence(doc);
            for (var name : scriptFunctionNames(method)) {
                if (sum != null) lines.add("/** " + sum + " */");
                lines.add(name + "<E extends keyof EventMap>(event: E, listener: (...args: EventMap[E]) => void): void;");
                // `any[]` (not `unknown[]`): a catch-all listener is contravariant, so a more
                // specific handler like `(id: number) => void` must remain assignable to it.
                lines.add(name + "(event: string, listener: (...args: any[]) => void): void;");
            }
            return lines;
        }

        // Parameter overrides from the docblock: `@cc-r.param <name> <type>` (e.g. a callback type that
        // the Java `Object` parameter can't express), or `@cc-r.params <list>` to replace the whole list.
        var tsParam = new java.util.HashMap<String, String>();
        for (var tag : blockTags(doc, "cc-r.param")) {
            var sp = tag.indexOf(' ');
            if (sp > 0) tsParam.put(tag.substring(0, sp), tag.substring(sp + 1).trim());
        }
        // `@cc-r.hide <name> [<name> …]` — drop parameters from the TS signature (e.g. an injected target).
        var hidden = new java.util.HashSet<String>();
        for (var tag : blockTags(doc, "cc-r.hide")) {
            for (var n : tag.split("[\\s,]+")) if (!n.isEmpty()) hidden.add(n);
        }
        var fullParams = blockTagText(doc, "cc-r.params");

        String paramStr;
        if (fullParams != null) {
            paramStr = fullParams.trim();
        } else {
            // Drop runtime-injected context; map Optional<>/IArguments/Coerced<>.
            var params = new ArrayList<String>();
            for (var p : method.getParameters()) {
                var name = p.getSimpleName().toString();
                if (hidden.contains(name)) continue;
                if (tsParam.containsKey(name)) {
                    params.add(name + ": " + tsParam.get(name));
                    continue;
                }
                var pType = p.asType();
                var simple = simpleName(pType);
                if (simple.equals("IComputerAccess") || simple.equals("IContext")
                    || simple.equals("IComputerSystem") || simple.equals("IAPIEnvironment")) continue;
                if (simple.equals("IArguments")) {
                    params.add("...args: unknown[]");
                    continue;
                }
                if (simple.equals("Optional") && pType instanceof DeclaredType dt && !dt.getTypeArguments().isEmpty()) {
                    params.add(name + "?: " + tsType(dt.getTypeArguments().get(0)));
                } else {
                    params.add(name + ": " + tsType(pType));
                }
            }
            paramStr = String.join(", ", params);
        }

        // Return type: explicit @cc-r.return wins, else map the Java type (+ | null if @Nullable).
        var ret = blockTagText(doc, "cc-r.return");
        if (ret != null) {
            ret = ret.trim();
        } else {
            ret = tsType(method.getReturnType());
            if (!ret.equals("void") && !ret.contains("null") && isNullable(method)) ret = ret + " | null";
        }

        var summary = firstSentence(doc);
        var lines = new ArrayList<String>();
        for (var name : scriptFunctionNames(method)) {
            if (summary != null) lines.add("/** " + summary + " */");
            lines.add(name + "(" + paramStr + "): " + ret + ";");
        }
        return lines;
    }

    // ── Type mapping ────────────────────────────────────────────────────────────
    private String tsType(TypeMirror t) {
        return switch (t.getKind()) {
            case BOOLEAN -> "boolean";
            case INT, LONG, SHORT, BYTE, DOUBLE, FLOAT, CHAR -> "number";
            case VOID, NONE -> "void";
            case ARRAY -> tsType(((ArrayType) t).getComponentType()) + "[]";
            case DECLARED -> mapDeclared((DeclaredType) t);
            default -> "unknown";
        };
    }

    private String mapDeclared(DeclaredType d) {
        var simple = ((TypeElement) d.asElement()).getSimpleName().toString();
        var args = d.getTypeArguments();
        return switch (simple) {
            case "Boolean" -> "boolean";
            case "Integer", "Long", "Short", "Byte", "Double", "Float", "Number" -> "number";
            case "String", "CharSequence" -> "string";
            case "List", "Collection", "Set", "Iterable" ->
                (args.isEmpty() ? "unknown" : tsType(args.get(0))) + "[]";
            case "Map" -> "Record<string, " + (args.size() == 2 ? tsType(args.get(1)) : "unknown") + ">";
            case "Optional", "Coerced" -> args.isEmpty() ? "unknown" : tsType(args.get(0));
            case "Object", "MethodResult" -> "unknown"; // opaque/dynamic result; override with @cc-r.return
            case "ByteBuffer" -> "string";              // CC represents binary data as strings
            case "ScriptTable" -> "Record<string, unknown>";
            default -> {
                // A record used as a type becomes a JS object, an enum a string union — remember
                // either so we emit a matching declaration alongside the interface that uses it.
                var el = d.asElement();
                if (el.getKind() == ElementKind.RECORD) referencedRecords.add((TypeElement) el);
                else if (el.getKind() == ElementKind.ENUM) referencedEnums.add((TypeElement) el);
                yield simple;
            }
        };
    }

    // ── Element/doc helpers ─────────────────────────────────────────────────────
    private List<String> scriptFunctionNames(ExecutableElement method) {
        for (var am : method.getAnnotationMirrors()) {
            if (!simpleName(am.getAnnotationType()).equals("ScriptFunction")) continue;
            for (var entry : am.getElementValues().entrySet()) {
                if (!entry.getKey().getSimpleName().contentEquals("value")) continue;
                var names = new ArrayList<String>();
                collectStrings(entry.getValue().getValue(), names);
                if (!names.isEmpty()) return names;
            }
        }
        return List.of(method.getSimpleName().toString());
    }

    @SuppressWarnings("unchecked")
    private void collectStrings(Object value, List<String> into) {
        if (value instanceof String s) {
            into.add(s);
        } else if (value instanceof List<?> list) {
            for (var item : list) {
                if (item instanceof javax.lang.model.element.AnnotationValue av) collectStrings(av.getValue(), into);
            }
        }
    }

    /** Whether a record component is {@code @Nullable} (annotation on the component or its type). */
    private boolean isNullableComponent(javax.lang.model.element.RecordComponentElement comp) {
        return hasAnnotation(comp.getAnnotationMirrors(), "Nullable")
            || hasAnnotation(comp.asType().getAnnotationMirrors(), "Nullable");
    }

    private boolean isNullable(ExecutableElement method) {
        if (hasAnnotation(method.getAnnotationMirrors(), "Nullable")) return true;
        return hasAnnotation(method.getReturnType().getAnnotationMirrors(), "Nullable");
    }

    private boolean hasAnnotation(List<? extends AnnotationMirror> annos, String simple) {
        for (var am : annos) {
            if (simpleName(am.getAnnotationType()).equals(simple)) return true;
        }
        return false;
    }

    /** Whether {@code type} is, extends, or implements (transitively) a type with the given simple name. */
    private boolean isAssignableTo(TypeElement type, String simple) {
        if (type.getSimpleName().contentEquals(simple)) return true;
        for (var supertype : supertypes(type)) {
            if (isAssignableTo(supertype, simple)) return true;
        }
        return false;
    }

    private String simpleName(TypeMirror t) {
        return t instanceof DeclaredType d ? ((TypeElement) d.asElement()).getSimpleName().toString() : t.toString();
    }

    /** First sentence of a doc comment, flattened to one line. */
    private String firstSentence(DocCommentTree doc) {
        if (doc == null) return null;
        var text = flatten(doc.getFirstSentence()).trim();
        return text.isEmpty() ? null : text;
    }

    /** The text content of the first {@code @<name>} block tag (e.g. {@code cc.tsreturn}). */
    private String blockTagText(DocCommentTree doc, String tagName) {
        var all = blockTags(doc, tagName);
        return all.isEmpty() ? null : all.get(0);
    }

    /** The first-line value of every {@code @<name>} block tag (e.g. each {@code cc-r.param}). */
    private List<String> blockTags(DocCommentTree doc, String tagName) {
        var out = new ArrayList<String>();
        if (doc == null) return out;
        for (var tag : doc.getBlockTags()) {
            if (tag instanceof UnknownBlockTagTree u && u.getTagName().equals(tagName)) out.add(tagValue(u.getContent()));
        }
        return out;
    }

    /**
     * Extract a single-line type/parameter value from a block-tag's content: only the first line is taken
     * (so a following {@code <pre>} example or prose isn't slurped in), {@code {@code …}} is unwrapped, and a
     * stray trailing {@code ;} / {@code ,} is dropped.
     */
    private String tagValue(List<? extends DocTree> content) {
        var sb = new StringBuilder();
        for (var tree : content) {
            if (tree instanceof com.sun.source.doctree.LiteralTree lit) {
                sb.append(lit.getBody().getBody());
            } else if (tree instanceof com.sun.source.doctree.TextTree txt) {
                var s = txt.getBody();
                var nl = s.indexOf('\n');
                if (nl >= 0) { sb.append(s, 0, nl); break; }
                sb.append(s);
            } else {
                break; // an HTML element (e.g. <pre>) or inline tag — not part of the value
            }
        }
        return sb.toString().replaceAll("\\s+", " ").trim().replaceAll("[;,.]\\s*$", "");
    }

    /** Flatten doc trees to text. {@code {@code …}} / {@code {@literal …}} bodies are taken verbatim, so
     *  TS types with {@code <>}, {@code |} or {@code =>} survive javadoc's HTML handling. */
    private String flatten(List<? extends DocTree> trees) {
        var sb = new StringBuilder();
        for (var tree : trees) {
            if (tree instanceof com.sun.source.doctree.LiteralTree lit) {
                sb.append(lit.getBody().getBody());
            } else {
                sb.append(tree.toString());
            }
        }
        return sb.toString().replaceAll("\\s+", " ").trim();
    }
}
