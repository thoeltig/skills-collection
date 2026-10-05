# Code annotation attributes

The JetBrains.Annotations framework provides a number of attributes described below. To use these attributes in your code, you need to reference `JetBrains.Annotations` as described in the Annotations in source code section.

## CanBeNullAttribute

Indicates that the value of the marked element could be null sometimes, so checking for null is required before its usage.

```csharp
[CanBeNull] object Test() => null;

void UseTest() {
  var p = Test();
  var s = p.ToString(); // Warning: Possible 'System.NullReferenceException'
}
```

## NotNullAttribute

Indicates that the value of the marked element can never be null.

```csharp
[NotNull] object Foo() {
  return null; // Warning: Possible 'null' assignment
}
```

## ItemNotNullAttribute

Can be applied to symbols of types derived from IEnumerable as well as to symbols of Task and Lazy classes to indicate that the value of a collection item, of the Task.Result property, or of the Lazy.Value property can never be null.


```csharp
public void Foo([ItemNotNull]List<string> books)
{
  foreach (var book in books) {
    if (book != null) // Warning: Expression is always true
     Console.WriteLine(book.ToUpper());
  }
}
```

## ItemCanBeNullAttribute

Can be applied to symbols of types derived from IEnumerable as well as to symbols of Task and Lazy classes to indicate that the value of a collection item, of the Task.Result property, or of the Lazy.Value property can be null.

```csharp
public void Foo([ItemCanBeNull]List<string> books)
{
  foreach (var book in books)
  {
    // Warning: Possible 'System.NullReferenceException'
    Console.WriteLine(book.ToUpper());
  }
}
```

## StringFormatMethodAttribute

Indicates that the marked method builds a string by the format pattern and (optional) arguments. The parameter that accepts the format string should be specified in the constructor. The format string should be in the `System.String.Format(System.IFormatProvider,System.String,System.Object[])-`like form.

```csharp
[StringFormatMethod("message")]
void ShowError(string message, params object[] args) { /* do something */ }

void Foo() {
  ShowError("Failed: {0}"); // Warning: Non-existing argument in format string
}
```

`#ctor(System.String)` Specifies which parameter of an annotated method should be treated as the format string.

## StructuredMessageTemplateAttribute

Indicates that the marked parameter is a message template where placeholders are to be replaced by the following arguments in the order in which they appear.

```csharp
void LogInfo([StructuredMessageTemplate]string message, params object[] args) { /* do something */ }

void Foo() {
  LogInfo("User created: {username}"); // Warning: Non-existing argument in format string
}
```

## ValueProviderAttribute

Use this annotation to specify a type that contains static or const fields with values for the annotated property/field/parameter. The specified type will be used to improve completion suggestions.

```csharp
namespace TestNamespace
{
  public class Constants
  {
    public static int INT_CONST = 1;
    public const string STRING_CONST = "1";
  }

  public class Class1
  {
    [ValueProvider("TestNamespace.Constants")] public int myField;
    public void Foo([ValueProvider("TestNamespace.Constants")] string str) { }

    public void Test()
    {
      Foo(/*try completion here*/);//
      myField = /*try completion here*/
    }
  }
}
```

## ValueRangeAttribute

Indicates that the integral value falls into the specified interval. It is allowed to specify multiple non-intersecting intervals. Values of interval boundaries are included in the interval.

```csharp
void Foo([ValueRange(0, 100)] int value) {
  if (value == -1) { // Warning: Expression is always 'false'
    ...
  }
}
```

## NonNegativeValueAttribute

Indicates that the integral value never falls below zero.

```csharp
void Foo([NonNegativeValue] int value) {
  if (value == -1) { // Warning: Expression is always 'false'
    ...
  }
}
```

## InvokerParameterNameAttribute

Indicates that the function argument should be a string literal and match one of the parameters of the caller function. This annotation is used for parameters like string paramName parameter of the System.ArgumentNullException constructor.

```csharp
void Foo(string param) {
  if (param == null)
    throw new ArgumentNullException("par"); // Warning: Cannot resolve symbol
}
```

## NotifyPropertyChangedInvocatorAttribute

Indicates that the method is contained in a type that implements the `System.ComponentModel.INotifyPropertyChanged` interface and this method is used to notify that some property value changed.

The method should be non-static and conform to one of the supported signatures:
- `NotifyChanged(string)`
- `NotifyChanged(params string[])`
- `NotifyChanged{T}(Expression{Func{T}})`
- `NotifyChanged{T,U}(Expression{Func{T,U}})`
- `SetProperty{T}(ref T, T, string)`

```csharp
public class Foo : INotifyPropertyChanged {
  public event PropertyChangedEventHandler PropertyChanged;

  [NotifyPropertyChangedInvocator]
  protected virtual void NotifyChanged(string propertyName) { ... }

  string _name;

  public string Name {
    get { return _name; }
    set { _name = value; NotifyChanged("LastName"); /* Warning */ }
  }
}
```

Examples of generated notifications:
- `NotifyChanged("Property")`
- `NotifyChanged(() => Property)`
- `NotifyChanged((VM x) => x.Property)`
- `SetProperty(ref myField, value, "Property")`

## ContractAnnotationAttribute

Contract annotations let you define expected outputs for given inputs, or put in other words, define dependencies between reference type and boolean arguments of a function and its return value. The mechanism of contract annotations allows creating APIs that could be consumed in an easier and safer way.

**Tip**: Sometimes you may want to use simpler alternatives instead of contract annotations. For example, if your function never returns 'null' independently of the input, you can use the `[NotNull]` attribute.

You can implement contract annotations by decorating your functions with the `[ContractAnnotationAttribute]`. If you want to do it in your source code, reference the `JetBrains.Annotations` namespace. You can also annotate functions in existing binary modules using external annotations.

Function Definition Table syntax:
- `FDT ::= FDTRow [;FDTRow]*`
- `FDTRow ::= Input => Output | Output <= Input`
- `Input ::= ParameterName: Value [, Input]*`
- `Output ::= [ParameterName: Value]* {halt|stop|void|nothing|Value}`
- `Value ::= true | false | null | notnull | canbenull`

If the method has a single input parameter, its name could be omitted. Using halt (or void/nothing, which is the same) for the method output means that the method doesn't return normally (throws or terminates the process). The canbenull value is only applicable to output parameters. You can use multiple `[ContractAnnotation]` for each FDT row, or use a single attribute with rows separated by the semicolon. The order of rows doesn't matter, all rows are checked for applicability and applied per each program state tracked by the analysis engine.

```csharps
[ContractAnnotation("=> halt")]
public void TerminationMethod()
```

```csharp
[ContractAnnotation("null <= param:null")] // reverse condition syntax
public string GetName(string surname)
```

```csharp
[ContractAnnotation("s:null => true")]
public bool IsNullOrEmpty(string s) // string.IsNullOrEmpty()
```

```csharp
// A method that returns null if the parameter is null,
// and not null if the parameter is not null
[ContractAnnotation("null => null; notnull => notnull")]
public object Transform(object data)
```

```csharp
[ContractAnnotation("=> true, result: notnull; => false, result: null")]
public bool TryParse(string s, out Person result)
```

```csharp
[ContractAnnotation("[paramName:][input] => output [; [paramName:][input] => output]", [forceFullStates:true])]
```

The input can be:
- `null` / `notnull` for reference type parameters
- `true` / `false` for boolean parameters.

The output can be
- `null` / `notnull` / `canbenull` for the return value of reference type
- `true` / `false` for the return value of boolean type
- `halt` / `stop` / `void` / `nothing` (which are interchangeable) to indicate that the function does not return normally. That is, it throws an exception or halts program execution.

The optional boolean `forceFullStates` parameter, which is false by default, allows you to force the pessimistic mode for the nullability analysis. That is, if the method return value is not defined by the contract condition, ReSharper assumes that it might be null.

Remarks:
- You can omit paramName if there is only one parameter.
- You can omit both paramName and input if there are no parameters:
  ```csharp
  [ContractAnnotation("=> halt")]
  public void TerminationMethod()
  ```
  or if the function has the same output independently of the input:
  ```csharp
  [ContractAnnotation("=> halt")]
  public void TerminationMethod(object data, bool flag)
  ```
- You can add several conditions for the same parameter:
  ```csharp
  [ContractAnnotation("input:null => null; input:notnull=>notnull")]
  public object Transform(object input, bool flag)
  ```
- You can reverse conditions, that is `input => output` is equal to `output <= input`:
  ```csharp
  [ContractAnnotation("null <= surname:null")]
  public string GetName(string surname)
  ```
- You can also specify expected values for 'out' parameters. If you want to specify both a return value and an 'out' parameter for the same input condition, use the comma:
  ```csharp
  [ContractAnnotation("s:null => false,result:null")]
  public bool TryParse(string s, out object result)
  ```

## LocalizationRequiredAttribute

Indicates whether the marked element should be localized.

```csharp
[LocalizationRequiredAttribute(true)]
class Foo {
  string str = "my string"; // Warning: Localizable string
}
```

## CannotApplyEqualityOperatorAttribute

Indicates that the value of the marked type (or its derivatives) cannot be compared using == or != operators, and Equals() should be used instead. However, using == or != for comparison with null is always permitted.

```csharp
[CannotApplyEqualityOperator]
class NoEquality { }

class UsesNoEquality {
  void Test() {
    var ca1 = new NoEquality();
    var ca2 = new NoEquality();
    if (ca1 != null) { // OK
      bool condition = ca1 == ca2; // Warning
    }
  }
}
```

## DefaultEqualityUsageAttribute

Indicates that the method or type uses equality members of the annotated element.

When applied to the method's generic parameter, indicates that the equality of the annotated type is used, unless a custom equality comparer is passed when calling this method. The attribute can also be applied directly to the method's parameter or return type to specify equality usage for it. When applied to the type's generic parameter, indicates that type equality usage can happen anywhere inside this type, so the instantiation of this type is treated as equality usage, unless a custom equality comparer is passed to the constructor.

```csharp
struct StructWithDefaultEquality { }

class MySet<[DefaultEqualityUsage] T> { }

static class Extensions {
    public static MySet<T> ToMySet<[DefaultEqualityUsage] T>(this IEnumerable<T> items) => new();
}

class MyList<T> { public int IndexOf([DefaultEqualityUsage] T item) => 0; }

class UsesDefaultEquality {
    void Test() {
        var list = new MyList<StructWithDefaultEquality>();
        list.IndexOf(new StructWithDefaultEquality()); // Warning: Default equality of struct 'StructWithDefaultEquality' is used

        var set = new MySet<StructWithDefaultEquality>(); // Warning: Default equality of struct 'StructWithDefaultEquality' is used
        var set2 = new StructWithDefaultEquality[1].ToMySet(); // Warning: Default equality of struct 'StructWithDefaultEquality' is used
    }
}
```

## BaseTypeRequiredAttribute

When applied to a target attribute, specifies a requirement for any type marked with the target attribute to implement or inherit the specific type or types.

```csharp
[BaseTypeRequired(typeof(IComponent)] // Specify requirement
class ComponentAttribute : Attribute { }

[Component] // ComponentAttribute requires implementing IComponent interface
class MyComponent : IComponent { }
```

## UsedImplicitlyAttribute

Indicates that the marked symbol is used implicitly (via reflection, in an external library, and so on), so this symbol will be ignored by usage-checking inspections. You can use `ImplicitUseKindFlags` and `ImplicitUseTargetFlags` to configure how this attribute is applied.

```csharp
[UsedImplicitly]
public class TypeConverter {}

public class SummaryData
{
  [UsedImplicitly(ImplicitUseKindFlags.InstantiatedWithFixedConstructorSignature)]
  public SummaryData() {}
}

[UsedImplicitly(ImplicitUseTargetFlags.WithInheritors | ImplicitUseTargetFlags.Default)]
public interface IService {}
```

### ImplicitUseKindFlags

Specifies the details of an implicitly used symbol when it is marked with `MeansImplicitUseAttribute` or `UsedImplicitlyAttribute`.
- `Access` Only entity marked with attribute considered used.
- `Assign` Indicates implicit assignment to a member.
- `InstantiatedWithFixedConstructorSignature` Indicates implicit instantiation of a type with fixed constructor signature. That means any unused constructor parameters will not be reported as such.
- `InstantiatedNoFixedConstructorSignature` Indicates implicit instantiation of a type.

### ImplicitUseTargetFlags

Specifies what is considered to be used implicitly when marked with `MeansImplicitUseAttribute` or `UsedImplicitlyAttribute`.
- `Members` Members of the type marked with the attribute are considered used.
- `WithInheritors` Inherited entities are considered used.
- `WithMembers` Entity marked with the attribute and all its members considered used.

## MeansImplicitUseAttribute

Can be applied to attributes, type parameters, and parameters of a type assignable from System.Type. When applied to an attribute, the decorated attribute behaves the same as `UsedImplicitlyAttribute`. When applied to a type parameter or to a parameter of type System.Type, indicates that the corresponding type is used implicitly.

## PublicAPIAttribute

This attribute is intended to mark publicly available APIs that should not be removed and therefore should never be reported as unused.

## InstantHandleAttribute

Tells the code analysis engine if the parameter is completely handled when the invoked method is on stack. If the parameter is a delegate, indicates that the delegate can only be invoked during method execution (the delegate can be invoked zero or multiple times, but not stored to some field and invoked later, when the containing method is no longer on the execution stack). If the parameter is an enumerable, indicates that it is enumerated while the method is executed. If `RequireAwait` is true, the attribute will only take effect if the method invocation is located under the await expression.

`RequireAwait` Requires the method invocation to be used under the await expression for this attribute to take effect. Can be used for delegate/enumerable parameters of async methods.

## PureAttribute

Indicates that the method does not make any observable state changes. The same as `System.Diagnostics.Contracts.PureAttribute`.

```csharp
[Pure] int Multiply(int x, int y) => x * y;

void M() {
  Multiply(123, 42); // Warning: Return value of pure method is not used
}
```

## MustUseReturnValueAttribute

Indicates that the return value of the method invocation must be used.

Methods decorated with this attribute (in contrast to pure methods) might change state, but make no sense without using their return value. Similarly to PureAttribute, this attribute will help detect usages of the method when the return value is not used. Optionally, you can specify a message to use when showing warnings, e.g.

```csharp
[MustUseReturnValue("Use the return value to...")]
```

## MustDisposeResourceAttribute

Indicates that the resource disposal must be handled at the use site, meaning that the resource ownership is transferred to the caller. This annotation can be used to annotate disposable types or their constructors individually to enable the IDE code analysis for resource disposal in every context where the new instance of this type is created. Factory methods and out parameters can also be annotated to indicate that the return value of the disposable type needs handling.

Annotation of input parameters with this attribute is meaningless. Constructors inherit this attribute from their type if it is annotated, but not from the base constructors they delegate to (if any). Resource disposal is expected via using (resource) statement, using var declaration, explicit `Dispose()` call, or passing the resource as an argument to a parameter annotated with the `HandlesResourceDisposalAttribute` attribute.

`Value` When set to false, disposing of the resource is not obligatory. The main use-case for explicit `[MustDisposeResource(false)]` annotation is to loosen the annotation for inheritors.

This annotation triggers the dispose analysis and the corresponding Inlay Hints.

## HandlesResourceDisposalAttribute

Indicates that method or class instance acquires resource ownership and will dispose it after use.

Annotation of out parameters with this attribute is meaningless. When an instance method is annotated with this attribute, it means that it is handling the resource disposal of the corresponding resource instance. When a field or a property is annotated with this attribute, it means that this type owns the resource and will handle the resource disposal properly (e.g. in own IDisposable implementation).

## RequireStaticDelegateAttribute

This annotation allows enforcing allocation-less usage patterns of delegates for performance-critical APIs. When this annotation is applied to the parameter of a delegate type, the IDE checks the input argument of this parameter: * When a lambda expression or anonymous method is passed as an argument, the IDE verifies that the passed closure has no captures of the containing local variables and the compiler is able to cache the delegate instance to avoid heap allocations. Otherwise, a warning is produced. * The IDE warns when the method name or local function name is passed as an argument because this always results in heap allocation of the delegate instance.

In C# 9.0+ code, the IDE will also suggest annotating the anonymous functions with the static modifier to make use of the similar analysis provided by the language/compiler.

## ProvidesContextAttribute

Indicates the type member or parameter of some type that should be used instead of all other ways to get the value of that type. This annotation is useful when you have some 'context' value evaluated and stored somewhere, meaning that all other ways to get this value must be consolidated with the existing one.

```csharp
class Foo {
  [ProvidesContext] IBarService _barService = ...;

  void ProcessNode(INode node) {
    DoSomething(node, node.GetGlobalServices().Bar);
    //              ^ Warning: use value of '_barService' field
  }
}
```

## PathReferenceAttribute

Indicates that a parameter is a path to a file or a folder within a web project. Path can be relative or absolute, starting from web root (~).

## SourceTemplateAttribute

An extension method marked with this attribute is processed by code completion as a 'Source Template'. When the extension method is completed over some expression, its source code is automatically expanded like a template at the call site.

Template method bodies can contain valid source code and/or special comments starting with '$'. Text inside these comments is added as source code when the template is applied. Template parameters can be used either as additional method parameters or as identifiers wrapped in two '$' signs. Use the MacroAttribute attribute to specify macros for parameters. The expression to be used in the expansion can be adjusted by the Target parameter.

In this example, the forEach method is a source template available over all values of enumerable types, producing an ordinary C# foreach statement and placing the caret inside the block:

```csharp
[SourceTemplate]
public static void forEach<T>(this IEnumerable<T> xs) {
  foreach (var x in xs) {
     //$ $END$
  }
}
```

`Target` Allows specifying the expression to capture for template execution if more than one expression is available at the expansion point. If not specified, Inner is assumed.

### SourceTemplateTargetExpression

Provides a value for the `SourceTemplateAttribute` to define how to capture the expression at the point of expansion.

Selects inner expression:

```csharp
value > 42.{caret} captures 42
```

```csharp
_args = args.{caret} captures args
```

Selects outer expression:

```csharp
value > 42.{caret} captures value > 42
```

```csharp
_args = args.{caret} captures whole assignment
```

## MacroAttribute

Allows specifying a macro for a parameter of a `SourceTemplateAttribute`. You can apply the attribute to the whole method or to any of its additional parameters. The macro expression is defined in the Expression property. When applied to a method, the target template parameter is defined in the Target property. To apply the macro silently for the parameter, set the Editable property value to -1.

```csharp
Applying the attribute to a source template method:

[SourceTemplate, Macro(Target = "item", Expression = "suggestVariableName()")]
public static void forEach<T>(this IEnumerable<T> collection) {
  foreach (var item in collection) {
    //$ $END$
  }
}
```

Applying the attribute to a template method parameter:

```csharp
[SourceTemplate]
public static void something(this Entity x, [Macro(Expression = "guid()", Editable = -1)] string newguid) {
  /*$ var $x$Id = "$newguid$" + x.ToString();
  x.DoSomething($x$Id); */
}
```

- `Expression` Allows specifying a macro that will be executed for a `SourceTemplateAttribute` parameter when the template is expanded.
- `Editable` Allows specifying the occurrence of the target parameter that becomes editable when the template is deployed. If the target parameter is used several times in the template, only one occurrence becomes editable; other occurrences are changed synchronously. To specify the zero-based index of the editable occurrence, use values >= 0. To make the parameter non-editable when the template is expanded, use -1.
- `Target` Identifies the target parameter of a `SourceTemplateAttribute` if the MacroAttribute is applied to a template method.

## CollectionAccessAttribute

Indicates how a method, constructor invocation, or property access over a collection type affects the contents of the collection. When applied to a return value of a method, indicates whether the returned collection is created exclusively for the caller (`CollectionAccessType.UpdatedContent`) or can be read/updated from outside (`CollectionAccessType.Read`/`CollectionAccessType.UpdatedContent`). Use `CollectionAccessType` to specify the access type.

Using this attribute only makes sense if all collection methods are marked with this attribute.

```csharp
public class MyStringCollection : List<string>
{
  [CollectionAccess(CollectionAccessType.Read)]
  public string GetFirstString()
  {
    return this.ElementAt(0);
  }
}
class Test
{
  public void Foo()
  {
    // Warning: Contents of the collection is never updated
    var col = new MyStringCollection();
    string x = col.GetFirstString();
  }
}
```

### CollectionAccessType

Provides a value for the `CollectionAccessAttribute` to define how the collection method invocation affects the contents of the collection.
- `None` Method does not use or modify content of the collection.
- `Read` Method only reads content of the collection but does not modify it.
- `ModifyExistingContent` Method can change content of the collection but does not add new elements.
- `UpdatedContent` Method can add new elements to the collection.

## AssertionMethodAttribute

Indicates that the marked method is an assertion method, i.e. it halts the control flow if one of the conditions is satisfied. To set the condition, mark one of the parameters with `AssertionConditionAttribute` attribute.

## AssertionConditionAttribute

Indicates the condition parameter of the assertion method. The method itself should be marked by the `AssertionMethodAttribute` attribute. The mandatory argument of the attribute is the assertion type.Specifies the assertion type. If the assertion method argument satisfies the condition, then the execution continues. Otherwise, execution is assumed to be halted.
- `IS_TRUE` Marked parameter should be evaluated to true.
- `IS_FALSE` Marked parameter should be evaluated to false.
- `IS_NULL` Marked parameter should be evaluated to null value.
- `IS_NOT_NULL` Marked parameter should be evaluated to not null value.

## TerminatesProgramAttribute

Indicates that the marked method unconditionally terminates control flow execution. For example, it could unconditionally throw an exception.

## LinqTunnelAttribute

Indicates that the method is a pure LINQ method with postponed enumeration (like `Enumerable.Select` or `Enumerable.Where`). This annotation allows inference of the `[InstantHandle]` annotation for parameters of delegate type by analyzing LINQ method chains.

## NoEnumerationAttribute

Indicates that an `IEnumerable` passed as a parameter is not enumerated. Use this annotation to suppress the 'Possible multiple enumeration of IEnumerable' inspection.

```csharp
static void ThrowIfNull<T>([NoEnumeration] T v, string n) where T : class
{
  // custom check for null but no enumeration
}

void Foo(IEnumerable<string> values)
{
  ThrowIfNull(values, nameof(values));
  var x = values.ToList(); // No warnings about multiple enumeration
}
```

## RegexPatternAttribute

Indicates that the marked parameter, field, or property is a regular expression pattern.

## LanguageInjectionAttribute

Indicates that the marked parameter, field, or property accepts string literals containing code fragments in a specified language.

```csharp
void Foo([LanguageInjection(InjectedLanguage.CSS, Prefix = "body{", Suffix = "}")] string cssProps)
{
  // cssProps should only contain a list of CSS properties
}
```

```csharp
void Bar([LanguageInjection("json")] string json)
{
}
```

- `InjectedLanguage` Specifies a language of the injected code fragment.
- `InjectedLanguageName` Specifies a language name of the injected code fragment.
- `Prefix` Specifies a string that 'precedes' the injected string literal.
- `Suffix` Specifies a string that 'follows' the injected string literal.

## NoReorderAttribute

Prevents the Member Reordering feature in the IDE from tossing members of the marked class. The attribute must be mentioned in your member reordering patterns.

## CodeTemplateAttribute

Defines a code search pattern using the Structural Search and Replace syntax. It allows you to find and, if necessary, replace blocks of code that match a specific pattern.
- `SearchTemplate` Structural search pattern. The pattern includes a textual part, which must only contain identifiers allowed in the target language and placeholders to match variable parts of the target code blocks.
- `Message` Message to show when a code block matching the search pattern was found. You can also prepend the message text with 'Error:', 'Warning:', 'Suggestion:' or 'Hint:' prefix to specify the pattern severity. Code patterns with replace templates have the 'Suggestion' severity by default. If a replace pattern is not provided, the pattern will have the 'Warning' severity.
- `ReplaceTemplate` Replace pattern to use for replacing a matched pattern.
- `ReplaceMessage` Replace message to show in the light bulb.
- `FormatAfterReplace` Apply code formatting after code replacement.
- `MatchSimilarConstructs` Whether similar code blocks should be matched.
- `ShortenReferences` Automatically insert namespace import directives or remove qualifiers that become redundant after the template is applied.
- `SuppressionKey` The string to use as a suppression key. By default, the following suppression key is used: `CodeTemplate_SomeType_SomeMember`, where 'SomeType' and 'SomeMember' are names of the associated containing type and member, to which this attribute is applied.

Search and replace patterns consist of a textual part and placeholders. Textural part must contain only identifiers allowed in the target language and will be matched exactly (whitespaces, tabulation characters, and line breaks are ignored). Placeholders allow matching variable parts of the target code blocks. A placeholder has the following format: `$placeholder_name$` - where `placeholder_name` is an arbitrary identifier. Predefined placeholders:
- `this$` - expression of containing type
- `$thisType$` - containing type
- `$member$` - current member placeholder
- `$qualifier$` - this placeholder is available in the replace pattern and can be used to insert a qualifier expression matched by the `$member$` placeholder. (Note that if `$qualifier$` placeholder is used, then `$member$` placeholder will match only qualified references)
- `$expression$` - expression of any type
- `$identifier$` - identifier placeholder
- `$args$` - any number of arguments
- `$arg$` - single argument
- `$arg1$ ... $arg10$` - single argument
- `$stmts$` - any number of statements
- `$stmt$` - single statement
- `$stmt1$ ... $stmt10$` - single statement
- `$name{Expression, 'Namespace.FooType'}$` - expression with the Namespace.FooType type
- `$expression{'Namespace.FooType'}$` - expression with the Namespace.FooType type
- `$name{Type, 'Namespace.FooType'}$` - Namespace.FooType type
- `$type{'Namespace.FooType'}$` - Namespace.FooType type
- `$statement{1,2}$` - 1 or 2 statements

## IgnoreSpellingAndGrammarErrorsAttribute

Indicates that the string literal passed as an argument to this parameter should not be checked for spelling or grammar errors.

## AspMvcActionAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC action. If applied to a method, the MVC action name is calculated implicitly from the context. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.ChildActionExtensions.RenderAction(HtmlHelper, String)`.

## AspMvcAreaAttribute

ASP.NET MVC attribute. Indicates that the marked parameter is an MVC area. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.ChildActionExtensions.RenderAction(HtmlHelper, String)`.

## AspMvcControllerAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC controller. If applied to a method, the MVC controller name is calculated implicitly from the context. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.ChildActionExtensions.RenderAction(HtmlHelper, String, String)`.

## AspMvcMasterAttribute

ASP.NET MVC attribute. Indicates that the marked parameter is an MVC Master. Use this attribute for custom wrappers similar to `System.Web.Mvc.Controller.View(String, String)`.

## AspMvcModelTypeAttribute

ASP.NET MVC attribute. Indicates that the marked parameter is an MVC model type. Use this attribute for custom wrappers similar to `System.Web.Mvc.Controller.View(String, Object)`.

## AspMvcPartialViewAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC partial view. If applied to a method, the MVC partial view name is calculated implicitly from the context. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.RenderPartialExtensions.RenderPartial(HtmlHelper, String)`.

## AspMvcSuppressViewErrorAttribute

ASP.NET MVC attribute. Allows disabling inspections for MVC views within a class or a method.

## AspMvcDisplayTemplateAttribute

ASP.NET MVC attribute. Indicates that a parameter is an MVC display template. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.DisplayExtensions.DisplayForModel(HtmlHelper, String)`.

## AspMvcEditorTemplateAttribute

ASP.NET MVC attribute. Indicates that the marked parameter is an MVC editor template. Use this attribute for custom wrappers similar to `System.Web.Mvc.Html.EditorExtensions.EditorForModel(HtmlHelper, String)`.

## AspMvcTemplateAttribute

ASP.NET MVC attribute. Indicates that the marked parameter is an MVC template. Use this attribute for custom wrappers similar to `System.ComponentModel.DataAnnotations.UIHintAttribute(System.String)`.

## AspMvcViewAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC view component. If applied to a method, the MVC view name is calculated implicitly from the context. Use this attribute for custom wrappers similar to `System.Web.Mvc.Controller.View(Object)`.

## AspMvcViewComponentAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC view component name.

## AspMvcViewComponentViewAttribute

ASP.NET MVC attribute. If applied to a parameter, indicates that the parameter is an MVC view component view. If applied to a method, the MVC view component view name is default.

## AspMvcActionSelectorAttribute

ASP.NET MVC attribute. When applied to a parameter of an attribute, indicates that this parameter is an MVC action name.

```csharp
[ActionName("Foo")]
public ActionResult Login(string returnUrl) {
  ViewBag.ReturnUrl = Url.Action("Foo"); // OK
  return RedirectToAction("Bar"); // Error: Cannot resolve action
}
```

## RouteTemplateAttribute

Indicates that the marked parameter, field, or property is a route template. This attribute allows IDE to recognize the use of web frameworks' route templates to enable syntax highlighting, code completion, navigation, rename and other features in string literals.

## nRouteParameterConstraintAttribute

Indicates that the marked type is custom route parameter constraint, which is registered in the application's Startup with the name ConstraintName.
You can specify ProposedType if target constraint matches only route parameters of specific type, it will allow IDE to create method's parameter from usage in route template with specified type instead of default System.String and check if constraint's proposed type conflicts with matched parameter's type.

## UriStringAttribute

Indicates that the marked parameter, field, or property is a URI string. This attribute enables code completion, navigation, renaming, and other features in URI string literals assigned to annotated parameters, fields, or properties.

## AspRouteConventionAttribute

Indicates that the marked method declares routing convention for ASP.NET. The IDE will analyze all usages of methods marked with this attribute, and will add all routes to completion, navigation, and other features over URI strings.

## AspDefaultRouteValuesAttribute

Indicates that the marked method parameter contains default route values of routing convention for ASP.NET.

## AspRouteValuesConstraintsAttribute

Indicates that the marked method parameter contains constraints on route values of routing convention for ASP.NET.

## AspRouteOrderAttribute

Indicates that the marked parameter or property contains routing order provided by ASP.NET routing attribute.

## AspRouteVerbsAttribute

Indicates that the marked parameter or property contains HTTP verbs provided by ASP.NET routing attribute.

## AspAttributeRoutingAttribute

Indicates that the marked attribute is used for attribute routing in ASP.NET. The IDE will analyze all usages of attributes marked with this attribute, and will add all routes to completion, navigation and other features over URI strings.

## AspMinimalApiDeclarationAttribute

Indicates that the marked method declares an ASP.NET Minimal API endpoint. The IDE will analyze all usages of methods marked with this attribute, and will add all routes to completion, navigation and other features over URI strings.

## AspMinimalApiGroupAttribute

Indicates that the marked method declares an ASP.NET Minimal API endpoints group.

## AspMinimalApiHandlerAttribute

Indicates that the marked parameter contains an ASP.NET Minimal API endpoint handler.

## AspMinimalApiImplicitEndpointDeclarationAttribute

Indicates that the marked method contains Minimal API endpoint declaration. The IDE will analyze all usages of methods marked with this attribute, and will add all declared in attributes routes to completion, navigation and other features over URI strings.
`QueryParameters` Comma-separated list of query parameters defined for endpoint

## RazorSectionAttribute

Razor attribute. Indicates that the marked parameter or method is a Razor section. Use this attribute for custom wrappers similar to `System.Web.WebPages.WebPageBase.RenderSection(String)`.

## XamlItemsControlAttribute

XAML attribute. Indicates the type that has an ItemsSource property and should be treated as an `ItemsControl`-derived type, to enable inner items DataContext type resolution.

## XamlItemBindingOfItemsControlAttribute

XAML attribute. Indicates the property of some BindingBase-derived type, that is used to bind some item of an `ItemsControl`-derived type. This annotation will enable the DataContext type resolution for XAML bindings for such properties. The property should have a tree ancestor of the `ItemsControl` type or marked with the `XamlItemsControlAttribute` attribute.

## XamlItemStyleOfItemsControlAttribute

XAML attribute. Indicates the property of some Style-derived type that is used to style items of an `ItemsControl`-derived type. This annotation will enable the DataContext type resolution in XAML bindings for such properties.Property should have a tree ancestor of the `ItemsControl` type or marked with the `XamlItemsControlAttribute` attribute.

## XamlOneWayBindingModeByDefaultAttribute

XAML attribute. Indicates that DependencyProperty has OneWay binding mode by default. This attribute must be applied to DependencyProperty's CLR accessor property if it is present, or to a DependencyProperty descriptor field otherwise.

## XamlTwoWayBindingModeByDefaultAttribute

XAML attribute. Indicates that DependencyProperty has TwoWay binding mode by default. This attribute must be applied to DependencyProperty's CLR accessor property if it is present, or to a DependencyProperty descriptor field otherwise.

## TestSubjectAttribute

Specifies a type being tested by a test class or a test method. This information can be used by the IDE to navigate between tests and tested types, or by test runners to group tests by subject and to provide better test reports.
- `Subject` Gets the type being tested.
- `#ctor(System.Type)` Initializes a new instance of the TestSubjectAttribute class with the specified tested type. The type being tested.

## MeansTestSubjectAttribute

Marks a generic argument as the test subject for a test class. Can be applied to a generic parameter of a base test class to indicate that the type passed as the argument is the class being tested. This information can be used by the IDE to navigate between tests and tested types, or by test runners to group tests by subject and to provide better test reports.

```csharp
public class BaseTestClass<[MeansTestSubject] T>
{
  protected T Component { get; }
}

public class CalculatorAdditionTests : BaseTestClass<Calculator>
{
  [Test]
  public void Should_add_two_numbers()
  {
     Assert.That(Component.Add(2, 3), Is.EqualTo(5));
  }
}
```
