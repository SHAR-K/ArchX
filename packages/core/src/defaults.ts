import type { ArchitectureNode, ArchitecturePartition, ProjectSpec, VerificationPlan } from "./types.ts";

export const emptyVerification = (): VerificationPlan => ({
  build: [],
  tests: [],
  staticAnalysis: [],
  simulation: [],
  logs: [],
});

export function createNode(input: Partial<ArchitectureNode> = {}): ArchitectureNode {
  const id = input.id ?? crypto.randomUUID();
  return {
    id,
    name: input.name ?? "New architecture node",
    kind: input.kind ?? "module",
    parentId: input.parentId ?? null,
    lifecycle: input.lifecycle ?? "draft",
    ...(input.domain ? { domain: input.domain } : {}),
    responsibility: input.responsibility ?? "",
    inputs: input.inputs ?? [],
    outputs: input.outputs ?? [],
    ownedPaths: input.ownedPaths ?? [],
    codeBindings: input.codeBindings ?? [],
    acceptanceCriteria: input.acceptanceCriteria ?? [],
    verification: input.verification ?? emptyVerification(),
    position: input.position ?? { x: 120, y: 120 },
  };
}

export function normalizeProject(project: ProjectSpec): ProjectSpec {
  return {
    ...project,
    schemaVersion: 4,
    architecture: {
      ...project.architecture,
      nodes: project.architecture.nodes.map((node) => ({ ...node, codeBindings: node.codeBindings ?? [] })),
      mappings: project.architecture.mappings ?? [],
    },
    partitions: project.partitions ?? [],
  };
}

export function createPartition(input: Partial<ArchitecturePartition> & Pick<ArchitecturePartition, "name" | "focusPaths">): ArchitecturePartition {
  const generatedId = input.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const id = input.id ?? (generatedId || crypto.randomUUID());
  return {
    id,
    name: input.name,
    focusPaths: input.focusPaths,
    readContextPaths: input.readContextPaths ?? [],
    ownedPaths: input.ownedPaths ?? [...input.focusPaths],
    boundaryDepth: input.boundaryDepth ?? 1,
    nodeIds: input.nodeIds ?? [],
  };
}

export function createDefaultProject(name = "archx"): ProjectSpec {
  const root = createNode({
    id: "system-root",
    name,
    kind: "system",
    responsibility: "",
    position: { x: 320, y: 80 },
  });
  return {
    schemaVersion: 4,
    project: {
      name,
      summary: "",
      language: "C/C++",
      platform: "",
      codeStyle: "Explicit names, short functions, few side effects",
      commitConvention: "Conventional Commits",
    },
    policy: {
      dependencyDefault: "deny",
      requireImpactReview: true,
      requireVerificationEvidence: true,
    },
    architecture: { nodes: [root], relations: [], mappings: [] },
    partitions: [],
    changes: [],
  };
}
