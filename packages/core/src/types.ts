export type NodeKind = "system" | "layer" | "module" | "component";
export type NodeLifecycle = "draft" | "discussing" | "confirmed" | "implementing" | "verified";
export type ChangeStatus = "draft" | "approved" | "executing" | "verifying" | "complete";

export interface Point {
  x: number;
  y: number;
}

export interface VerificationPlan {
  build: string[];
  tests: string[];
  staticAnalysis: string[];
  simulation: string[];
  logs: string[];
}

export type CodeBindingType = "entrypoint" | "interface" | "implementation" | "test" | "config" | "build";
export type CodeBindingSource = "planned" | "agent" | "archcheck";
export type CodeBindingStatus = "planned" | "resolved" | "stale";

export interface CodeBinding {
  id: string;
  type: CodeBindingType;
  role: string;
  file: string;
  symbol?: string;
  symbolId?: string;
  line?: number;
  source: CodeBindingSource;
  status: CodeBindingStatus;
}

// 执行域：嵌入式架构的第一维度。isr=中断上下文，task=RTOS 任务，host=宿主可测纯逻辑，hw=硬件/驱动，build=构建与配置资产。
export type ExecutionDomain = "isr" | "task" | "host" | "hw" | "build";
export const executionDomains: readonly ExecutionDomain[] = ["isr", "task", "host", "hw", "build"];

export interface ArchitectureNode {
  id: string;
  name: string;
  kind: NodeKind;
  parentId: string | null;
  lifecycle: NodeLifecycle;
  domain?: ExecutionDomain;
  responsibility: string;
  inputs: string[];
  outputs: string[];
  ownedPaths: string[];
  codeBindings: CodeBinding[];
  acceptanceCriteria: string[];
  verification: VerificationPlan;
  position: Point;
}

export interface ArchitectureRelation {
  id: string;
  sourceId: string;
  targetId: string;
  type: "depends_on" | "data_flow";
  label: string;
}

export type ArchitectureMappingKind = "path" | "symbol";
export type ArchitectureMappingSource = "manual" | "agent";

export interface ArchitectureMapping {
  id: string;
  targetNodeId: string;
  kind: ArchitectureMappingKind;
  pattern: string;
  source: ArchitectureMappingSource;
  createdAt: string;
}

export interface ArchitecturePartition {
  id: string;
  name: string;
  focusPaths: string[];
  readContextPaths: string[];
  ownedPaths: string[];
  boundaryDepth: number;
  nodeIds: string[];
}

export interface DiscussionMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
}

export interface ChangeRequest {
  id: string;
  title: string;
  intent: string;
  targetNodeIds: string[];
  architectureDelta: string;
  status: ChangeStatus;
  discussion: DiscussionMessage[];
}

export interface ProjectSpec {
  schemaVersion: 4;
  project: {
    name: string;
    summary: string;
    language: string;
    platform: string;
    codeStyle: string;
    commitConvention: string;
  };
  policy: {
    dependencyDefault: "deny" | "allow";
    requireImpactReview: boolean;
    requireVerificationEvidence: boolean;
  };
  architecture: {
    nodes: ArchitectureNode[];
    relations: ArchitectureRelation[];
    mappings: ArchitectureMapping[];
  };
  partitions: ArchitecturePartition[];
  changes: ChangeRequest[];
}

export interface GateItem {
  id: string;
  label: string;
  passed: boolean;
  detail: string;
}

export interface ExecutionPacket {
  project: string;
  change: string;
  node: string;
  objective: string;
  ownedPaths: string[];
  excludedPaths: string[];
  codeBindings: CodeBinding[];
  allowedDependencies: string[];
  acceptanceCriteria: string[];
  verification: VerificationPlan;
  instructions: string[];
}

export interface ArchitectureProposalNode {
  key: string;
  name: string;
  kind: Exclude<NodeKind, "system">;
  parentKey?: string;
  domain?: ExecutionDomain;
  responsibility: string;
  inputs: string[];
  outputs: string[];
  ownedPaths?: string[];
  codeBindings?: Array<Omit<CodeBinding, "id">>;
  acceptanceCriteria?: string[];
  verification?: Partial<VerificationPlan>;
}

export interface ArchitectureProposalNodePatch {
  name?: string;
  kind?: Exclude<NodeKind, "system">;
  domain?: ExecutionDomain;
  responsibility?: string;
  inputs?: string[];
  outputs?: string[];
  ownedPaths?: string[];
  codeBindings?: Array<Omit<CodeBinding, "id">>;
  acceptanceCriteria?: string[];
  verification?: Partial<VerificationPlan>;
}

export interface ArchitectureProposalNodeUpdate {
  nodeId: string;
  patch: ArchitectureProposalNodePatch;
}

export interface ArchitectureProposal {
  summary: string;
  nodes: ArchitectureProposalNode[];
  updatedNodes: ArchitectureProposalNodeUpdate[];
  dependencies: Array<{ sourceKey: string; targetKey: string; label?: string }>;
  removedNodeIds: string[];
}
