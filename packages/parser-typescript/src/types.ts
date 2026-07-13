export interface SourceLocation {
  start: number;
  end: number;
  line: number;
  character: number;
}

export interface SyntaxError {
  message: string;
  start: number;
  end: number;
  line: number;
  character: number;
}

export interface Modifier {
  kind: string;
}

export interface TypeParameter {
  name: string;
  constraint?: string;
  default?: string;
}

export interface HeritageClause {
  kind: "extends" | "implements";
  types: ExpressionWithTypeArguments[];
}

export interface ExpressionWithTypeArguments {
  expression: string;
  typeArguments?: string[];
}

export interface Parameter {
  name: string;
  type?: string;
  initializer?: string;
  isOptional: boolean;
  dotDotDotToken: boolean;
  start: number;
  end: number;
}

export interface NamedImport {
  name: string;
  alias?: string;
  isTypeOnly: boolean;
}

export interface NamedExport {
  name: string;
  alias?: string;
  isTypeOnly: boolean;
}

export interface ImportDeclaration {
  moduleSpecifier: string;
  namedImports: NamedImport[];
  defaultImport?: string;
  namespaceImport?: string;
  isTypeOnly: boolean;
  start: number;
  end: number;
}

export interface ExportDeclaration {
  moduleSpecifier?: string;
  namedExports: NamedExport[];
  exportClause?: string;
  isTypeOnly: boolean;
  start: number;
  end: number;
}

export interface ClassMember {
  kind: "property" | "method" | "constructor" | "accessor" | "get" | "set";
  name: string;
  type?: string;
  typeParameters?: TypeParameter[];
  parameters?: Parameter[];
  returnType?: string;
  modifiers: Modifier[];
  isStatic: boolean;
  isAbstract: boolean;
  isOptional: boolean;
  isReadonly: boolean;
  body?: string;
  start: number;
  end: number;
}

export interface InterfaceMember {
  kind: "property" | "method" | "call" | "construct" | "index";
  name: string;
  type?: string;
  typeParameters?: TypeParameter[];
  parameters?: Parameter[];
  returnType?: string;
  optional: boolean;
  readonly: boolean;
  start: number;
  end: number;
}

export interface EnumMember {
  name: string;
  value?: string | number;
  start: number;
  end: number;
}

export interface ClassDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  heritageClauses: HeritageClause[];
  members: ClassMember[];
  modifiers: Modifier[];
  start: number;
  end: number;
}

export interface InterfaceDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  heritageClauses: HeritageClause[];
  members: InterfaceMember[];
  start: number;
  end: number;
}

export interface EnumDeclaration {
  name: string;
  members: EnumMember[];
  isConst: boolean;
  start: number;
  end: number;
}

export interface FunctionDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  parameters: Parameter[];
  returnType?: string;
  body?: string;
  modifiers: Modifier[];
  isAsync: boolean;
  isGenerator: boolean;
  start: number;
  end: number;
}

export interface TypeAliasDeclaration {
  name: string;
  typeParameters: TypeParameter[];
  type: string;
  start: number;
  end: number;
}

export interface ParseResult {
  imports: ImportDeclaration[];
  exports: ExportDeclaration[];
  classes: ClassDeclaration[];
  interfaces: InterfaceDeclaration[];
  enums: EnumDeclaration[];
  functions: FunctionDeclaration[];
  typeAliases: TypeAliasDeclaration[];
  syntaxErrors: SyntaxError[];
}