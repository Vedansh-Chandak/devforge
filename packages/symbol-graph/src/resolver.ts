import type {
  ParsedFile,
  SymbolNode,
  SymbolId,
  SymbolKind,
  Location,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  ClassMember,
  InterfaceMember,
  EnumMember,
  Modifier,
  TypeParameter,
  Parameter,
} from "./types.js";

export function createSymbolId(
  filePath: string,
  kind: SymbolKind,
  name: string,
  location: Location
): SymbolId {
  return { filePath, kind, name, declarationLocation: location };
}

export function resolveLocalSymbols(parsedFile: ParsedFile): SymbolNode[] {
  const nodes: SymbolNode[] = [];

  for (const cls of parsedFile.classes) {
    nodes.push(createClassSymbol(parsedFile.filePath, cls));
    for (const member of cls.members) {
      nodes.push(createMemberSymbol(parsedFile.filePath, cls.name, member));
    }
  }

  for (const iface of parsedFile.interfaces) {
    nodes.push(createInterfaceSymbol(parsedFile.filePath, iface));
    for (const member of iface.members) {
      nodes.push(createInterfaceMemberSymbol(parsedFile.filePath, iface.name, member));
    }
  }

  for (const enumDecl of parsedFile.enums) {
    nodes.push(createEnumSymbol(parsedFile.filePath, enumDecl));
    for (const member of enumDecl.members) {
      nodes.push(createEnumMemberSymbol(parsedFile.filePath, enumDecl.name, member));
    }
  }

  for (const func of parsedFile.functions) {
    nodes.push(createFunctionSymbol(parsedFile.filePath, func));
  }

  for (const typeAlias of parsedFile.typeAliases) {
    nodes.push(createTypeAliasSymbol(parsedFile.filePath, typeAlias));
  }

  return nodes;
}

function toModifiers(kinds: string[]): Modifier[] {
  return kinds.map((k) => ({ kind: k }));
}

function createClassSymbol(filePath: string, cls: ClassDeclaration): SymbolNode {
  const location: Location = { start: cls.start, end: cls.end, line: 0, character: 0 };
  return {
    id: createSymbolId(filePath, "class", cls.name, location),
    kind: "class",
    name: cls.name,
    qualifiedName: cls.name,
    filePath,
    declarationLocation: location,
    modifiers: toModifiers(cls.modifiers.map((m) => m.kind)),
    typeParameters: cls.typeParameters,
    metadata: {},
  };
}

function createInterfaceSymbol(filePath: string, iface: InterfaceDeclaration): SymbolNode {
  const location: Location = { start: iface.start, end: iface.end, line: 0, character: 0 };
  return {
    id: createSymbolId(filePath, "interface", iface.name, location),
    kind: "interface",
    name: iface.name,
    qualifiedName: iface.name,
    filePath,
    declarationLocation: location,
    modifiers: [],
    typeParameters: iface.typeParameters,
    metadata: {},
  };
}

function createEnumSymbol(filePath: string, enumDecl: EnumDeclaration): SymbolNode {
  const location: Location = { start: enumDecl.start, end: enumDecl.end, line: 0, character: 0 };
  return {
    id: createSymbolId(filePath, "enum", enumDecl.name, location),
    kind: "enum",
    name: enumDecl.name,
    qualifiedName: enumDecl.name,
    filePath,
    declarationLocation: location,
    modifiers: enumDecl.isConst ? toModifiers(["const"]) : [],
    typeParameters: [],
    metadata: {},
  };
}

function createFunctionSymbol(filePath: string, func: FunctionDeclaration): SymbolNode {
  const location: Location = { start: func.start, end: func.end, line: 0, character: 0 };
  const modKinds = [...func.modifiers.map((m) => m.kind)];
  if (func.isAsync) modKinds.push("async");
  if (func.isGenerator) modKinds.push("generator");
  return {
    id: createSymbolId(filePath, "function", func.name, location),
    kind: "function",
    name: func.name,
    qualifiedName: func.name,
    filePath,
    declarationLocation: location,
    modifiers: toModifiers(modKinds),
    typeParameters: func.typeParameters,
    signature: {
      parameters: func.parameters,
      returnType: func.returnType,
      typeParameters: func.typeParameters,
    },
    metadata: {},
  };
}

function createTypeAliasSymbol(filePath: string, typeAlias: TypeAliasDeclaration): SymbolNode {
  const location: Location = { start: typeAlias.start, end: typeAlias.end, line: 0, character: 0 };
  return {
    id: createSymbolId(filePath, "type-alias", typeAlias.name, location),
    kind: "type-alias",
    name: typeAlias.name,
    qualifiedName: typeAlias.name,
    filePath,
    declarationLocation: location,
    modifiers: [],
    typeParameters: typeAlias.typeParameters,
    metadata: {},
  };
}

function createMemberSymbol(
  filePath: string,
  className: string,
  member: ClassMember
): SymbolNode {
  const location: Location = { start: member.start, end: member.end, line: 0, character: 0 };
  const kind = member.kind === "constructor" ? "function" : member.kind === "property" ? "variable" : "function";
  const name = `${className}.${member.name}`;
  const modKinds = [...member.modifiers.map((m) => m.kind)];
  if (member.isStatic) modKinds.push("static");
  if (member.isAbstract) modKinds.push("abstract");
  if (member.isReadonly) modKinds.push("readonly");
  return {
    id: createSymbolId(filePath, kind, name, location),
    kind,
    name,
    qualifiedName: name,
    filePath,
    declarationLocation: location,
    modifiers: toModifiers(modKinds),
    typeParameters: member.typeParameters || [],
    metadata: {},
  };
}

function createInterfaceMemberSymbol(
  filePath: string,
  interfaceName: string,
  member: InterfaceMember
): SymbolNode {
  const location: Location = { start: member.start, end: member.end, line: 0, character: 0 };
  const kind = member.kind === "property" ? "variable" : "function";
  const name = `${interfaceName}.${member.name}`;
  const modKinds: string[] = [];
  if (member.readonly) modKinds.push("readonly");
  if (member.optional) modKinds.push("optional");
  return {
    id: createSymbolId(filePath, kind, name, location),
    kind,
    name,
    qualifiedName: name,
    filePath,
    declarationLocation: location,
    modifiers: toModifiers(modKinds),
    typeParameters: member.typeParameters || [],
    metadata: {},
  };
}

function createEnumMemberSymbol(
  filePath: string,
  enumName: string,
  member: EnumMember
): SymbolNode {
  const location: Location = { start: member.start, end: member.end, line: 0, character: 0 };
  const name = `${enumName}.${member.name}`;
  return {
    id: createSymbolId(filePath, "variable", name, location),
    kind: "variable",
    name,
    qualifiedName: name,
    filePath,
    declarationLocation: location,
    modifiers: toModifiers(["readonly"]),
    typeParameters: [],
    metadata: {},
  };
}