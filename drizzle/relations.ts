import { relations } from "drizzle-orm/relations";
import { workflows, workflowSchedules, workflowRuns, nodeExecutions, workflowNodes, workflowEdges, orchestratorChats, jkaiConversations, blogPosts, blogPostTags, workflowDataStore, jkaiAttachments, researchSession, entity, source, entityMention, fact, relationship, narrativeItem, globalEntity, globalEntityLink, agentTasks, agentActions, agentActivity, jkaiBuilds, jkaiIterations, jkaiLogs, cdoPlans } from "./schema";

export const workflowSchedulesRelations = relations(workflowSchedules, ({one}) => ({
	workflow: one(workflows, {
		fields: [workflowSchedules.workflowId],
		references: [workflows.id]
	}),
}));

export const workflowsRelations = relations(workflows, ({many}) => ({
	workflowSchedules: many(workflowSchedules),
	workflowRuns: many(workflowRuns),
	workflowNodes: many(workflowNodes),
	workflowEdges: many(workflowEdges),
	orchestratorChats: many(orchestratorChats),
	workflowDataStores: many(workflowDataStore),
}));

export const workflowRunsRelations = relations(workflowRuns, ({one, many}) => ({
	workflow: one(workflows, {
		fields: [workflowRuns.workflowId],
		references: [workflows.id]
	}),
	nodeExecutions: many(nodeExecutions),
}));

export const nodeExecutionsRelations = relations(nodeExecutions, ({one}) => ({
	workflowRun: one(workflowRuns, {
		fields: [nodeExecutions.runId],
		references: [workflowRuns.id]
	}),
	workflowNode: one(workflowNodes, {
		fields: [nodeExecutions.nodeId],
		references: [workflowNodes.id]
	}),
}));

export const workflowNodesRelations = relations(workflowNodes, ({one, many}) => ({
	nodeExecutions: many(nodeExecutions),
	workflow: one(workflows, {
		fields: [workflowNodes.workflowId],
		references: [workflows.id]
	}),
	workflowEdges_sourceNodeId: many(workflowEdges, {
		relationName: "workflowEdges_sourceNodeId_workflowNodes_id"
	}),
	workflowEdges_targetNodeId: many(workflowEdges, {
		relationName: "workflowEdges_targetNodeId_workflowNodes_id"
	}),
}));

export const workflowEdgesRelations = relations(workflowEdges, ({one}) => ({
	workflow: one(workflows, {
		fields: [workflowEdges.workflowId],
		references: [workflows.id]
	}),
	workflowNode_sourceNodeId: one(workflowNodes, {
		fields: [workflowEdges.sourceNodeId],
		references: [workflowNodes.id],
		relationName: "workflowEdges_sourceNodeId_workflowNodes_id"
	}),
	workflowNode_targetNodeId: one(workflowNodes, {
		fields: [workflowEdges.targetNodeId],
		references: [workflowNodes.id],
		relationName: "workflowEdges_targetNodeId_workflowNodes_id"
	}),
}));

export const orchestratorChatsRelations = relations(orchestratorChats, ({one, many}) => ({
	workflow: one(workflows, {
		fields: [orchestratorChats.workflowId],
		references: [workflows.id]
	}),
	jkaiConversation: one(jkaiConversations, {
		fields: [orchestratorChats.conversationId],
		references: [jkaiConversations.id]
	}),
	jkaiAttachments: many(jkaiAttachments),
}));

export const jkaiConversationsRelations = relations(jkaiConversations, ({many}) => ({
	orchestratorChats: many(orchestratorChats),
	jkaiAttachments: many(jkaiAttachments),
}));

export const blogPostTagsRelations = relations(blogPostTags, ({one}) => ({
	blogPost: one(blogPosts, {
		fields: [blogPostTags.postId],
		references: [blogPosts.id]
	}),
}));

export const blogPostsRelations = relations(blogPosts, ({many}) => ({
	blogPostTags: many(blogPostTags),
}));

export const workflowDataStoreRelations = relations(workflowDataStore, ({one}) => ({
	workflow: one(workflows, {
		fields: [workflowDataStore.workflowId],
		references: [workflows.id]
	}),
}));

export const jkaiAttachmentsRelations = relations(jkaiAttachments, ({one}) => ({
	jkaiConversation: one(jkaiConversations, {
		fields: [jkaiAttachments.conversationId],
		references: [jkaiConversations.id]
	}),
	orchestratorChat: one(orchestratorChats, {
		fields: [jkaiAttachments.messageId],
		references: [orchestratorChats.id]
	}),
}));

export const entityRelations = relations(entity, ({one, many}) => ({
	researchSession: one(researchSession, {
		fields: [entity.sessionId],
		references: [researchSession.id]
	}),
	entityMentions: many(entityMention),
	relationships_fromEntityId: many(relationship, {
		relationName: "relationship_fromEntityId_entity_id"
	}),
	relationships_toEntityId: many(relationship, {
		relationName: "relationship_toEntityId_entity_id"
	}),
	globalEntityLinks: many(globalEntityLink),
}));

export const researchSessionRelations = relations(researchSession, ({many}) => ({
	entities: many(entity),
	sources: many(source),
	facts: many(fact),
	relationships: many(relationship),
	narrativeItems: many(narrativeItem),
	globalEntityLinks: many(globalEntityLink),
	cdoPlans: many(cdoPlans),
}));

export const sourceRelations = relations(source, ({one, many}) => ({
	researchSession: one(researchSession, {
		fields: [source.sessionId],
		references: [researchSession.id]
	}),
	facts: many(fact),
	relationships: many(relationship),
}));

export const entityMentionRelations = relations(entityMention, ({one}) => ({
	entity: one(entity, {
		fields: [entityMention.entityId],
		references: [entity.id]
	}),
	fact: one(fact, {
		fields: [entityMention.factId],
		references: [fact.id]
	}),
}));

export const factRelations = relations(fact, ({one, many}) => ({
	entityMentions: many(entityMention),
	researchSession: one(researchSession, {
		fields: [fact.sessionId],
		references: [researchSession.id]
	}),
	source: one(source, {
		fields: [fact.sourceId],
		references: [source.id]
	}),
	fact: one(fact, {
		fields: [fact.refutesFactId],
		references: [fact.id],
		relationName: "fact_refutesFactId_fact_id"
	}),
	facts: many(fact, {
		relationName: "fact_refutesFactId_fact_id"
	}),
	relationships_fromFactId: many(relationship, {
		relationName: "relationship_fromFactId_fact_id"
	}),
	relationships_toFactId: many(relationship, {
		relationName: "relationship_toFactId_fact_id"
	}),
	narrativeItems: many(narrativeItem),
}));

export const relationshipRelations = relations(relationship, ({one}) => ({
	researchSession: one(researchSession, {
		fields: [relationship.sessionId],
		references: [researchSession.id]
	}),
	entity_fromEntityId: one(entity, {
		fields: [relationship.fromEntityId],
		references: [entity.id],
		relationName: "relationship_fromEntityId_entity_id"
	}),
	entity_toEntityId: one(entity, {
		fields: [relationship.toEntityId],
		references: [entity.id],
		relationName: "relationship_toEntityId_entity_id"
	}),
	fact_fromFactId: one(fact, {
		fields: [relationship.fromFactId],
		references: [fact.id],
		relationName: "relationship_fromFactId_fact_id"
	}),
	fact_toFactId: one(fact, {
		fields: [relationship.toFactId],
		references: [fact.id],
		relationName: "relationship_toFactId_fact_id"
	}),
	source: one(source, {
		fields: [relationship.sourceId],
		references: [source.id]
	}),
}));

export const narrativeItemRelations = relations(narrativeItem, ({one}) => ({
	researchSession: one(researchSession, {
		fields: [narrativeItem.sessionId],
		references: [researchSession.id]
	}),
	fact: one(fact, {
		fields: [narrativeItem.factId],
		references: [fact.id]
	}),
}));

export const globalEntityLinkRelations = relations(globalEntityLink, ({one}) => ({
	globalEntity: one(globalEntity, {
		fields: [globalEntityLink.globalEntityId],
		references: [globalEntity.id]
	}),
	entity: one(entity, {
		fields: [globalEntityLink.sessionEntityId],
		references: [entity.id]
	}),
	researchSession: one(researchSession, {
		fields: [globalEntityLink.sessionId],
		references: [researchSession.id]
	}),
}));

export const globalEntityRelations = relations(globalEntity, ({many}) => ({
	globalEntityLinks: many(globalEntityLink),
}));

export const agentActionsRelations = relations(agentActions, ({one, many}) => ({
	agentTask: one(agentTasks, {
		fields: [agentActions.taskId],
		references: [agentTasks.id]
	}),
	agentActivities: many(agentActivity),
}));

export const agentTasksRelations = relations(agentTasks, ({many}) => ({
	agentActions: many(agentActions),
	agentActivities: many(agentActivity),
}));

export const agentActivityRelations = relations(agentActivity, ({one}) => ({
	agentAction: one(agentActions, {
		fields: [agentActivity.actionId],
		references: [agentActions.id]
	}),
	agentTask: one(agentTasks, {
		fields: [agentActivity.taskId],
		references: [agentTasks.id]
	}),
}));

export const jkaiIterationsRelations = relations(jkaiIterations, ({one, many}) => ({
	jkaiBuild: one(jkaiBuilds, {
		fields: [jkaiIterations.buildId],
		references: [jkaiBuilds.id]
	}),
	jkaiLogs: many(jkaiLogs),
}));

export const jkaiBuildsRelations = relations(jkaiBuilds, ({many}) => ({
	jkaiIterations: many(jkaiIterations),
	jkaiLogs: many(jkaiLogs),
}));

export const jkaiLogsRelations = relations(jkaiLogs, ({one}) => ({
	jkaiBuild: one(jkaiBuilds, {
		fields: [jkaiLogs.buildId],
		references: [jkaiBuilds.id]
	}),
	jkaiIteration: one(jkaiIterations, {
		fields: [jkaiLogs.iterationId],
		references: [jkaiIterations.id]
	}),
}));

export const cdoPlansRelations = relations(cdoPlans, ({one}) => ({
	researchSession: one(researchSession, {
		fields: [cdoPlans.sessionId],
		references: [researchSession.id]
	}),
}));