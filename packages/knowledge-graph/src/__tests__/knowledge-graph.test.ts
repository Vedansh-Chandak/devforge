import { describe, it, expect, beforeEach } from "vitest";
import {
  buildKnowledgeGraph,
  getNode,
  getDependencies,
  getDependents,
  findServicesUsingRepository,
  findDatabaseAccessors,
  findModuleServices,
  findModuleApis,
  getGraphStats,
  getNodesByModule,
  hasDependency,
  hasNode,
} from "../index.js";
import { createSymbolGraph } from "@devforge/symbol-graph";
import type { SymbolNode, SymbolId, SymbolGraph, EdgeKind, ParsedFile } from "@devforge/symbol-graph";

function createMockSymbolId(name: string, kind: SymbolNode["kind"], filePath: string): SymbolId {
  return {
    filePath,
    kind,
    name,
    declarationLocation: { start: 0, end: 10, line: 1, character: 1 },
  };
}

function createMockSymbolNode(
  name: string,
  kind: SymbolNode["kind"],
  filePath: string,
  qualifiedName?: string
): SymbolNode {
  const id = createMockSymbolId(name, kind, filePath);
  return {
    id,
    kind,
    name,
    qualifiedName: qualifiedName || name,
    filePath,
    declarationLocation: { start: 0, end: 10, line: 1, character: 1 },
    modifiers: [],
    typeParameters: [],
    metadata: {},
  };
}

function createMockParsedFile(filePath: string, exports: string[] = []): ParsedFile {
  return {
    filePath,
    imports: [],
    exports: exports.map((name) => ({ name, alias: undefined, isTypeOnly: false, start: 0, end: 0 })),
    classes: [],
    interfaces: [],
    enums: [],
    functions: [],
    typeAliases: [],
    syntaxErrors: [],
  };
}

function createTestSymbolGraph(): SymbolGraph {
  const graph = createSymbolGraph();

  const userController = createMockSymbolNode(
    "UserController",
    "class",
    "src/modules/users/controllers/user.controller.ts"
  );
  const userService = createMockSymbolNode(
    "UserService",
    "class",
    "src/modules/users/services/user.service.ts"
  );
  const userRepository = createMockSymbolNode(
    "UserRepository",
    "class",
    "src/modules/users/repositories/user.repository.ts"
  );
  const userEntity = createMockSymbolNode(
    "UserEntity",
    "class",
    "src/modules/users/entities/user.entity.ts"
  );
  const userModule = createMockSymbolNode("UserModule", "class", "src/modules/users/user.module.ts");

  const apiController = createMockSymbolNode("ApiController", "class", "src/api/api.controller.ts");
  const authService = createMockSymbolNode("AuthService", "class", "src/auth/auth.service.ts");
  const orderHandler = createMockSymbolNode("OrderHandler", "class", "src/handlers/order.handler.ts");
  const productRepository = createMockSymbolNode(
    "ProductRepository",
    "class",
    "src/repositories/product.repository.ts"
  );
  const dbPrisma = createMockSymbolNode("PrismaDatabase", "class", "src/db/prisma.database.ts");

  const nodes = [
    userController,
    userService,
    userRepository,
    userEntity,
    userModule,
    apiController,
    authService,
    orderHandler,
    productRepository,
    dbPrisma,
  ];

  for (const node of nodes) {
    graph.nodes.set(
      `${node.filePath}:${node.kind}:${node.name}:${node.declarationLocation.start}:${node.declarationLocation.end}`,
      node
    );
    graph.outgoing.set(
      `${node.filePath}:${node.kind}:${node.name}:${node.declarationLocation.start}:${node.declarationLocation.end}`,
      []
    );
    graph.incoming.set(
      `${node.filePath}:${node.kind}:${node.name}:${node.declarationLocation.start}:${node.declarationLocation.end}`,
      []
    );
  }

  const edges: Array<{ from: SymbolId; to: SymbolId; kind: EdgeKind }> = [
    { from: userController.id, to: userService.id, kind: "imports" },
    { from: userService.id, to: userRepository.id, kind: "imports" },
    { from: userRepository.id, to: userEntity.id, kind: "imports" },
    { from: userRepository.id, to: dbPrisma.id, kind: "imports" },
    { from: userModule.id, to: userController.id, kind: "imports" },
    { from: userModule.id, to: userService.id, kind: "imports" },
    { from: apiController.id, to: authService.id, kind: "imports" },
    { from: orderHandler.id, to: productRepository.id, kind: "imports" },
    { from: productRepository.id, to: dbPrisma.id, kind: "imports" },
  ];

  for (const edge of edges) {
    graph.edges.push(edge);
    const fromKey = `${edge.from.filePath}:${edge.from.kind}:${edge.from.name}:${edge.from.declarationLocation.start}:${edge.from.declarationLocation.end}`;
    const toKey = `${edge.to.filePath}:${edge.to.kind}:${edge.to.name}:${edge.to.declarationLocation.start}:${edge.to.declarationLocation.end}`;
    graph.outgoing.get(fromKey)?.push(edge);
    graph.incoming.get(toKey)?.push(edge);
  }

  return graph;
}

function createTestParsedFiles(): ParsedFile[] {
  return [
    createMockParsedFile("src/modules/users/user.module.ts", ["UserModule"]),
    createMockParsedFile("src/modules/users/controllers/user.controller.ts", ["UserController"]),
    createMockParsedFile("src/modules/users/services/user.service.ts", ["UserService"]),
    createMockParsedFile("src/modules/users/repositories/user.repository.ts", ["UserRepository"]),
    createMockParsedFile("src/modules/users/entities/user.entity.ts", ["UserEntity"]),
    createMockParsedFile("src/api/api.controller.ts", ["ApiController"]),
    createMockParsedFile("src/auth/auth.service.ts", ["AuthService"]),
    createMockParsedFile("src/handlers/order.handler.ts", ["OrderHandler"]),
    createMockParsedFile("src/repositories/product.repository.ts", ["ProductRepository"]),
    createMockParsedFile("src/db/prisma.database.ts", ["PrismaDatabase"]),
  ];
}

describe("Knowledge Graph", () => {
  let symbolGraph: SymbolGraph;
  let parsedFiles: ParsedFile[];
  let kg: ReturnType<typeof buildKnowledgeGraph>;

  beforeEach(() => {
    symbolGraph = createTestSymbolGraph();
    parsedFiles = createTestParsedFiles();
    kg = buildKnowledgeGraph(symbolGraph, parsedFiles);
  });

  describe("Module recognition", () => {
    it("should recognize module from directory structure", () => {
      const module = getNode(kg, { kind: "module", name: "users" });
      expect(module).toBeDefined();
      expect(module?.kind).toBe("module");
      expect(module?.name).toBe("users");
    });
  });

  describe("Service recognition", () => {
    it("should recognize service from class name suffix", () => {
      const userService = getNode(kg, { kind: "service", name: "UserService" });
      expect(userService).toBeDefined();
      expect(userService?.kind).toBe("service");

      const authService = getNode(kg, { kind: "service", name: "AuthService" });
      expect(authService).toBeDefined();
      expect(authService?.kind).toBe("service");
    });

    it("should not recognize non-service classes as services", () => {
      const userController = getNode(kg, { kind: "service", name: "UserController" });
      expect(userController).toBeUndefined();

      const userRepository = getNode(kg, { kind: "service", name: "UserRepository" });
      expect(userRepository).toBeUndefined();
    });
  });

  describe("Repository recognition", () => {
    it("should recognize repository from class name suffix", () => {
      const userRepo = getNode(kg, { kind: "repository", name: "UserRepository" });
      expect(userRepo).toBeDefined();
      expect(userRepo?.kind).toBe("repository");

      const productRepo = getNode(kg, { kind: "repository", name: "ProductRepository" });
      expect(productRepo).toBeDefined();
      expect(productRepo?.kind).toBe("repository");
    });
  });

  describe("API recognition", () => {
    it("should recognize API from controller-like names", () => {
      const apiController = getNode(kg, { kind: "api", name: "ApiController" });
      expect(apiController).toBeDefined();
      expect(apiController?.kind).toBe("api");

      const orderHandler = getNode(kg, { kind: "api", name: "OrderHandler" });
      expect(orderHandler).toBeDefined();
      expect(orderHandler?.kind).toBe("api");
    });

    it("should not recognize services as APIs", () => {
      const userService = getNode(kg, { kind: "api", name: "UserService" });
      expect(userService).toBeUndefined();
    });
  });

  describe("Database recognition", () => {
    it("should recognize database from class name suffix", () => {
      const db = getNode(kg, { kind: "database", name: "PrismaDatabase" });
      expect(db).toBeDefined();
      expect(db?.kind).toBe("database");
    });
  });

  describe("Edge: contains", () => {
    it("should create contains edges from module to service", () => {
      const services = findModuleServices(kg, "users");
      const serviceNames = services.map((s) => s.name).sort();
      expect(serviceNames).toContain("UserService");
    });
  });

  describe("Edge: dependsOn", () => {
    it("should create dependsOn edges from controller to service", () => {
      const deps = getDependencies(kg, { kind: "api", name: "ApiController" });
      const depNames = deps.map((d) => d.to.name);
      expect(depNames).toContain("AuthService");
    });

    it("should create dependsOn edges from service to repository", () => {
      const deps = getDependencies(kg, { kind: "service", name: "UserService" });
      const depNames = deps.map((d) => d.to.name);
      expect(depNames).toContain("UserRepository");
    });

    it("should create dependsOn edges from repository to database", () => {
      const deps = getDependencies(kg, { kind: "repository", name: "UserRepository" });
      const depNames = deps.map((d) => d.to.name);
      expect(depNames).toContain("PrismaDatabase");
    });

    it("should create dependsOn edges from api to service", () => {
      const deps = getDependencies(kg, { kind: "api", name: "ApiController" });
      const depNames = deps.map((d) => d.to.name);
      expect(depNames).toContain("AuthService");
    });
  });

  describe("Query API", () => {
    it("should get node by ID", () => {
      const node = getNode(kg, { kind: "service", name: "UserService" });
      expect(node).toBeDefined();
      expect(node?.name).toBe("UserService");
    });

    it("should get dependencies", () => {
      const deps = getDependencies(kg, { kind: "service", name: "UserService" });
      expect(deps.length).toBeGreaterThan(0);
      const names = deps.map((d) => d.to.name);
      expect(names).toContain("UserRepository");
    });

    it("should get dependents", () => {
      const dependents = getDependents(kg, { kind: "repository", name: "UserRepository" });
      expect(dependents.length).toBeGreaterThan(0);
      const names = dependents.map((d) => d.from.name);
      expect(names).toContain("UserService");
    });

    it("should find services using repository", () => {
      const services = findServicesUsingRepository(kg, "UserRepository");
      expect(services.length).toBeGreaterThan(0);
      expect(services.map((s) => s.name)).toContain("UserService");
    });

    it("should find database accessors", () => {
      const accessors = findDatabaseAccessors(kg, "PrismaDatabase");
      expect(accessors.length).toBeGreaterThan(0);
      const names = accessors.map((a) => a.name);
      expect(names).toContain("UserRepository");
      expect(names).toContain("ProductRepository");
    });

    it("should find module services", () => {
      const services = findModuleServices(kg, "users");
      expect(services.length).toBeGreaterThan(0);
      expect(services.map((s) => s.name)).toContain("UserService");
    });

    it("should return graph stats", () => {
      const stats = getGraphStats(kg);
      expect(stats.nodeCount).toBeGreaterThan(0);
      expect(stats.edgeCount).toBeGreaterThan(0);
      expect(stats.nodesByKind.module).toBeGreaterThan(0);
      expect(stats.nodesByKind.service).toBeGreaterThan(0);
      expect(stats.nodesByKind.api).toBeGreaterThan(0);
      expect(stats.nodesByKind.repository).toBeGreaterThan(0);
      expect(stats.nodesByKind.database).toBeGreaterThan(0);
    });
  });

  describe("Unknown symbols ignored", () => {
    it("should not create nodes for unrecognized symbols", () => {
      const unknown = getNode(kg, { kind: "service", name: "UserModule" });
      expect(unknown).toBeUndefined();
    });
  });

  describe("Empty SymbolGraph", () => {
    it("should handle empty symbol graph", () => {
      const emptyGraph = createSymbolGraph();
      const emptyParsedFiles: ParsedFile[] = [];
      const emptyKg = buildKnowledgeGraph(emptyGraph, emptyParsedFiles);
      const stats = getGraphStats(emptyKg);
      expect(stats.nodeCount).toBe(0);
      expect(stats.edgeCount).toBe(0);
    });
  });

  describe("Public Query API", () => {
    it("should get nodes by module", () => {
      const nodes = getNodesByModule(kg, "users");
      const names = nodes.map((n) => n.name).sort();
      // Only services, APIs, and repositories are connected via "contains" edges
      expect(names).toContain("UserController");
      expect(names).toContain("UserService");
      expect(names).toContain("UserRepository");
      // UserEntity is an entity, not connected via contains edge
      // UserModule is the module itself, not a child
    });

    it("should return empty array for non-existent module", () => {
      const nodes = getNodesByModule(kg, "nonexistent");
      expect(nodes).toEqual([]);
    });

    it("should check hasNode for existing node", () => {
      expect(hasNode(kg, { kind: "service", name: "UserService" })).toBe(true);
      expect(hasNode(kg, { kind: "repository", name: "UserRepository" })).toBe(true);
      expect(hasNode(kg, { kind: "module", name: "users" })).toBe(true);
    });

    it("should check hasNode for non-existing node", () => {
      expect(hasNode(kg, { kind: "service", name: "NonExistent" })).toBe(false);
      expect(hasNode(kg, { kind: "repository", name: "NonExistent" })).toBe(false);
    });

    it("should check hasDependency for existing dependency", () => {
      expect(hasDependency(kg, { kind: "service", name: "UserService" }, { kind: "repository", name: "UserRepository" })).toBe(true);
      expect(hasDependency(kg, { kind: "repository", name: "UserRepository" }, { kind: "database", name: "PrismaDatabase" })).toBe(true);
      expect(hasDependency(kg, { kind: "api", name: "ApiController" }, { kind: "service", name: "AuthService" })).toBe(true);
    });

    it("should check hasDependency for non-existing dependency", () => {
      expect(hasDependency(kg, { kind: "service", name: "UserService" }, { kind: "repository", name: "NonExistent" })).toBe(false);
      expect(hasDependency(kg, { kind: "api", name: "ApiController" }, { kind: "service", name: "NonExistent" })).toBe(false);
    });

    it("should return false for hasDependency when from node does not exist", () => {
      expect(hasDependency(kg, { kind: "service", name: "NonExistent" }, { kind: "repository", name: "UserRepository" })).toBe(false);
    });

    it("should return false for hasDependency when to node does not exist", () => {
      expect(hasDependency(kg, { kind: "service", name: "UserService" }, { kind: "repository", name: "NonExistent" })).toBe(false);
    });

    it("should handle empty graph queries", () => {
      const emptyGraph = createSymbolGraph();
      const emptyParsedFiles: ParsedFile[] = [];
      const emptyKg = buildKnowledgeGraph(emptyGraph, emptyParsedFiles);

      expect(getNodesByModule(emptyKg, "users")).toEqual([]);
      expect(hasNode(emptyKg, { kind: "service", name: "UserService" })).toBe(false);
      expect(hasDependency(emptyKg, { kind: "service", name: "UserService" }, { kind: "repository", name: "UserRepository" })).toBe(false);
    });
  });
});