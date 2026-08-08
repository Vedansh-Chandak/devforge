import * as ts from "typescript";

import type {
  ImportDeclaration,
  ExportDeclaration,
  ClassDeclaration,
  InterfaceDeclaration,
  EnumDeclaration,
  FunctionDeclaration,
  TypeAliasDeclaration,
  NamedImport,
  NamedExport,
  TypeParameter,
  HeritageClause,
  ExpressionWithTypeArguments,
  ClassMember,
  InterfaceMember,
  EnumMember,
  Parameter,
  Modifier,
  SyntaxError,
  SourceLocation,
  ParseResult,
} from "./types.js";

function createLocation(node: ts.Node, sourceFile: ts.SourceFile): SourceLocation {
  const start = node.getStart(sourceFile);
  const end = node.getEnd();
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(start);
  return { start, end, line: line + 1, character: character + 1 };
}

function getModifiers(node: ts.Node): Modifier[] {
  const modifiers = (node as ts.HasModifiers).modifiers;
  if (!modifiers) return [];
  return modifiers.map((m) => ({ kind: ts.SyntaxKind[m.kind] }));
}

function getTypeParameters(typeParams?: ts.NodeArray<ts.TypeParameterDeclaration>): TypeParameter[] {
  if (!typeParams) return [];
  return typeParams.map((tp) => ({
    name: tp.name.text,
    constraint: tp.constraint?.getText(),
    default: tp.default?.getText(),
  }));
}

function getHeritageClauses(heritageClauses?: ts.NodeArray<ts.HeritageClause>): HeritageClause[] {
  if (!heritageClauses) return [];
  return heritageClauses.map((hc) => ({
    kind: hc.token === ts.SyntaxKind.ExtendsKeyword ? "extends" : "implements",
    types: hc.types.map((t) => ({
      expression: t.expression.getText(),
      typeArguments: t.typeArguments?.map((ta) => ta.getText()),
    })),
  }));
}

function parseParameters(params: ts.NodeArray<ts.ParameterDeclaration>, sourceFile: ts.SourceFile): Parameter[] {
  return params.map((param) => {
    const location = createLocation(param, sourceFile);
    return {
      name: param.name.getText(),
      type: param.type?.getText(),
      initializer: param.initializer?.getText(),
      isOptional: !!param.questionToken,
      dotDotDotToken: param.dotDotDotToken !== undefined,
      start: location.start,
      end: location.end,
    };
  });
}

function parseImportDeclaration(node: ts.ImportDeclaration, sourceFile: ts.SourceFile): ImportDeclaration {
  const location = createLocation(node, sourceFile);
  const moduleSpecifier = (node.moduleSpecifier as ts.StringLiteral).text;

  const namedImports: NamedImport[] = [];
  let defaultImport: string | undefined;
  let namespaceImport: string | undefined;

  if (node.importClause) {
    if (node.importClause.name) {
      defaultImport = node.importClause.name.text;
    }
    if (node.importClause.namedBindings) {
      if (ts.isNamespaceImport(node.importClause.namedBindings)) {
        namespaceImport = node.importClause.namedBindings.name.text;
      } else if (ts.isNamedImports(node.importClause.namedBindings)) {
        for (const element of node.importClause.namedBindings.elements) {
          namedImports.push({
            name: element.name.text,
            alias: element.propertyName?.text,
            isTypeOnly: element.isTypeOnly ?? false,
          });
        }
      }
    }
  }

  return {
    moduleSpecifier,
    namedImports,
    defaultImport,
    namespaceImport,
    isTypeOnly: node.importClause?.isTypeOnly ?? false,
    start: location.start,
    end: location.end,
  };
}

function parseExportDeclaration(node: ts.ExportDeclaration, sourceFile: ts.SourceFile): ExportDeclaration {
  const location = createLocation(node, sourceFile);
  const namedExports: NamedExport[] = [];

  if (node.exportClause && ts.isNamedExports(node.exportClause)) {
    for (const element of node.exportClause.elements) {
      namedExports.push({
        name: element.name.text,
        alias: element.propertyName?.text,
        isTypeOnly: element.isTypeOnly ?? false,
      });
    }
  }

  return {
    moduleSpecifier: node.moduleSpecifier ? (node.moduleSpecifier as ts.StringLiteral).text : undefined,
    namedExports,
    exportClause: node.exportClause?.getText(),
    isTypeOnly: node.isTypeOnly ?? false,
    start: location.start,
    end: location.end,
  };
}

function parseClassDeclaration(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): ClassDeclaration {
  const location = createLocation(node, sourceFile);
  const name = node.name?.text ?? "";
  const members: ClassMember[] = [];

  for (const member of node.members) {
    const memberLocation = createLocation(member, sourceFile);
    const memberModifiers = getModifiers(member as ts.Declaration);
    const isStatic = memberModifiers.some((m) => m.kind === "StaticKeyword");
    const isAbstract = memberModifiers.some((m) => m.kind === "AbstractKeyword");
    const isReadonly = memberModifiers.some((m) => m.kind === "ReadonlyKeyword");

    if (ts.isPropertyDeclaration(member)) {
      members.push({
        kind: "property",
        name: member.name.getText(),
        type: member.type?.getText(),
        modifiers: memberModifiers,
        isStatic,
        isAbstract,
        isOptional: !!member.questionToken,
        isReadonly,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isMethodDeclaration(member)) {
      members.push({
        kind: "method",
        name: member.name.getText(),
        typeParameters: getTypeParameters(member.typeParameters),
        parameters: parseParameters(member.parameters, sourceFile),
        returnType: member.type?.getText(),
        body: member.body?.getText(),
        modifiers: memberModifiers,
        isStatic,
        isAbstract,
        isOptional: !!member.questionToken,
        isReadonly,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isConstructorDeclaration(member)) {
      members.push({
        kind: "constructor",
        name: "constructor",
        parameters: parseParameters(member.parameters, sourceFile),
        body: member.body?.getText(),
        modifiers: memberModifiers,
        isStatic: false,
        isAbstract: false,
        isOptional: false,
        isReadonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isGetAccessorDeclaration(member)) {
      members.push({
        kind: "get",
        name: member.name.getText(),
        type: member.type?.getText(),
        modifiers: memberModifiers,
        isStatic,
        isAbstract: false,
        isOptional: false,
        isReadonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isSetAccessorDeclaration(member)) {
      members.push({
        kind: "set",
        name: member.name.getText(),
        parameters: parseParameters(member.parameters, sourceFile),
        modifiers: memberModifiers,
        isStatic,
        isAbstract: false,
        isOptional: false,
        isReadonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    }
  }

  return {
    name,
    typeParameters: getTypeParameters(node.typeParameters),
    heritageClauses: getHeritageClauses(node.heritageClauses),
    members,
    modifiers: getModifiers(node),
    start: location.start,
    end: location.end,
  };
}

function parseInterfaceDeclaration(node: ts.InterfaceDeclaration, sourceFile: ts.SourceFile): InterfaceDeclaration {
  const location = createLocation(node, sourceFile);
  const members: InterfaceMember[] = [];

  for (const member of node.members) {
    const memberLocation = createLocation(member, sourceFile);

    if (ts.isPropertySignature(member)) {
      members.push({
        kind: "property",
        name: member.name.getText(),
        type: member.type?.getText(),
        optional: !!member.questionToken,
        readonly: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isMethodSignature(member)) {
      members.push({
        kind: "method",
        name: member.name.getText(),
        typeParameters: getTypeParameters(member.typeParameters),
        parameters: parseParameters(member.parameters, sourceFile),
        returnType: member.type?.getText(),
        optional: !!member.questionToken,
        readonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isCallSignatureDeclaration(member)) {
      members.push({
        kind: "call",
        name: "__call",
        typeParameters: getTypeParameters(member.typeParameters),
        parameters: parseParameters(member.parameters, sourceFile),
        returnType: member.type?.getText(),
        optional: false,
        readonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isConstructSignatureDeclaration(member)) {
      members.push({
        kind: "construct",
        name: "__construct",
        typeParameters: getTypeParameters(member.typeParameters),
        parameters: parseParameters(member.parameters, sourceFile),
        returnType: member.type?.getText(),
        optional: false,
        readonly: false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    } else if (ts.isIndexSignatureDeclaration(member)) {
      members.push({
        kind: "index",
        name: member.parameters[0]?.name.getText() ?? "",
        type: member.type?.getText(),
        optional: false,
        readonly: member.modifiers?.some((m) => m.kind === ts.SyntaxKind.ReadonlyKeyword) ?? false,
        start: memberLocation.start,
        end: memberLocation.end,
      });
    }
  }

  return {
    name: node.name.text,
    typeParameters: getTypeParameters(node.typeParameters),
    heritageClauses: getHeritageClauses(node.heritageClauses),
    members,
    start: location.start,
    end: location.end,
  };
}

function parseEnumDeclaration(node: ts.EnumDeclaration, sourceFile: ts.SourceFile): EnumDeclaration {
  const location = createLocation(node, sourceFile);
  const members: EnumMember[] = [];

  for (const member of node.members) {
    const memberLocation = createLocation(member, sourceFile);
    let value: string | number | undefined;
    if (member.initializer) {
      if (ts.isStringLiteral(member.initializer)) {
        value = member.initializer.text;
      } else if (ts.isNumericLiteral(member.initializer)) {
        value = Number(member.initializer.text);
      } else {
        value = member.initializer.getText();
      }
    }
    members.push({
      name: member.name.getText(),
      value,
      start: memberLocation.start,
      end: memberLocation.end,
    });
  }

  return {
    name: node.name.text,
    members,
    isConst: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ConstKeyword) ?? false,
    start: location.start,
    end: location.end,
  };
}

function parseFunctionDeclaration(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): FunctionDeclaration {
  const location = createLocation(node, sourceFile);
  const name = node.name?.text ?? "";

  return {
    name,
    typeParameters: getTypeParameters(node.typeParameters),
    parameters: parseParameters(node.parameters, sourceFile),
    returnType: node.type?.getText(),
    body: node.body?.getText(),
    modifiers: getModifiers(node),
    isAsync: node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) ?? false,
    isGenerator: node.asteriskToken !== undefined,
    start: location.start,
    end: location.end,
  };
}

function parseTypeAliasDeclaration(node: ts.TypeAliasDeclaration, sourceFile: ts.SourceFile): TypeAliasDeclaration {
  const location = createLocation(node, sourceFile);
  return {
    name: node.name.text,
    typeParameters: getTypeParameters(node.typeParameters),
    type: node.type.getText(),
    start: location.start,
    end: location.end,
  };
}

function collectSyntaxErrors(sourceFile: ts.SourceFile): SyntaxError[] {
  const errors: SyntaxError[] = [];

  function visit(node: ts.Node) {
    if (node.kind === ts.SyntaxKind.Unknown) {
      const location = createLocation(node, sourceFile);
      errors.push({
        message: "Unknown syntax",
        start: location.start,
        end: location.end,
        line: location.line,
        character: location.character,
      });
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return errors;
}

export function parseTypeScript(code: string, fileName = "input.ts"): ParseResult {
  const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

  const result: ParseResult = {
    imports: [],
    exports: [],
    classes: [],
    interfaces: [],
    enums: [],
    functions: [],
    typeAliases: [],
    syntaxErrors: collectSyntaxErrors(sourceFile),
  };

  function recordExportedDeclaration(
    node: ts.Node,
    name: string | undefined,
    start: number,
    end: number
  ): void {
    if (!name) return;
    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const hasExport = modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ?? false;
    if (!hasExport) return;
    result.exports.push({
      moduleSpecifier: undefined,
      namedExports: [{ name, alias: undefined, isTypeOnly: false }],
      exportClause: undefined,
      isTypeOnly: false,
      start,
      end,
    });
  }

  function visit(node: ts.Node) {
    switch (node.kind) {
      case ts.SyntaxKind.ImportDeclaration:
        result.imports.push(parseImportDeclaration(node as ts.ImportDeclaration, sourceFile));
        break;
      case ts.SyntaxKind.ExportDeclaration:
        result.exports.push(parseExportDeclaration(node as ts.ExportDeclaration, sourceFile));
        break;
      case ts.SyntaxKind.ClassDeclaration: {
        const declaration = parseClassDeclaration(node as ts.ClassDeclaration, sourceFile);
        result.classes.push(declaration);
        recordExportedDeclaration(node, declaration.name, declaration.start, declaration.end);
        break;
      }
      case ts.SyntaxKind.InterfaceDeclaration: {
        const declaration = parseInterfaceDeclaration(node as ts.InterfaceDeclaration, sourceFile);
        result.interfaces.push(declaration);
        recordExportedDeclaration(node, declaration.name, declaration.start, declaration.end);
        break;
      }
      case ts.SyntaxKind.EnumDeclaration: {
        const declaration = parseEnumDeclaration(node as ts.EnumDeclaration, sourceFile);
        result.enums.push(declaration);
        recordExportedDeclaration(node, declaration.name, declaration.start, declaration.end);
        break;
      }
      case ts.SyntaxKind.FunctionDeclaration: {
        const declaration = parseFunctionDeclaration(node as ts.FunctionDeclaration, sourceFile);
        result.functions.push(declaration);
        recordExportedDeclaration(node, declaration.name, declaration.start, declaration.end);
        break;
      }
      case ts.SyntaxKind.TypeAliasDeclaration: {
        const declaration = parseTypeAliasDeclaration(node as ts.TypeAliasDeclaration, sourceFile);
        result.typeAliases.push(declaration);
        recordExportedDeclaration(node, declaration.name, declaration.start, declaration.end);
        break;
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);

  return result;
}