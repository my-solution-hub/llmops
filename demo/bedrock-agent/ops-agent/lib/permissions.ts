// create a class, used for generate CDK roles, policies
import { Construct } from "constructs";
import * as cdk from "aws-cdk-lib";
import { PolicyStatement } from "aws-cdk-lib/aws-iam";


export class Permissions{

    scope;
    constructor(scope: Construct){
        this.scope = scope;
    }

    createBedrockFlowRole(stackName: string, roleName: string){
        const flowRole = new cdk.aws_iam.Role(this.scope, 'FlowRole', {
            roleName: `${stackName}-${roleName}`,
            assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
            managedPolicies: [cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess')]
        })

        return flowRole;
    }

    // create lambda role
    createAgentLambdaRole(stackName: string, roleName: string){
        const lambdaRole = new cdk.aws_iam.Role(this.scope, 'LambdaRole', {
            roleName: `${stackName}-${roleName}`,
            assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
        })

        return lambdaRole;
    }

    createOrchestratorLambdaRole(stackName: string, roleName: string){
        const lambdaRole = new cdk.aws_iam.Role(this.scope, 'OrchestratorLambdaRole', {
            roleName: `${stackName}-${roleName}`,
            assumedBy: new cdk.aws_iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [cdk.aws_iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')]
        })

        return lambdaRole;
    }

    // create Bedrock role
    createBedrockAgentRole(stackName: string, roleName: string){

        // create a policy
        const agent_bedrock_policy = new cdk.aws_iam.Policy(this.scope, `${stackName}-${roleName}-AgentBedrockPolicy`, {
            policyName: `${stackName}-${roleName}-AgentBedrockPolicy`,
            statements: [
                new PolicyStatement({
                    sid: 'AmazonBedrockAgentBedrockFoundationModelPolicy',
                    effect: cdk.aws_iam.Effect.ALLOW,
                    actions: [
                        'bedrock:*',

                    ],
                    resources: ['*']
                    // 'arn:aws:bedrock:${region}::foundation-model/anthropic.claude-v2:1'
                })
            ],
        })

        const agent_s3_schema_policy = new cdk.aws_iam.Policy(this.scope, `${stackName}-${roleName}-AgentS3Policy`, {
            policyName: `${stackName}-${roleName}-AgentS3Policy`,
            statements: [
                new PolicyStatement({
                    sid: 'AllowAgentAccessOpenAPISchema',
                    effect: cdk.aws_iam.Effect.ALLOW,
                    actions: [
                        's3:GetObject'
                    ],
                    resources: ['*']
                })
            ],
        })
        const agentRole = new cdk.aws_iam.Role(this.scope, `${stackName}-${roleName}`, {
            roleName: `${stackName}-${roleName}`,
            assumedBy: new cdk.aws_iam.ServicePrincipal('bedrock.amazonaws.com'),
        })

        agentRole.attachInlinePolicy(agent_bedrock_policy);
        agentRole.attachInlinePolicy(agent_s3_schema_policy);
        return agentRole;
    }


}
