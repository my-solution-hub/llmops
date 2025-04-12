import { Construct } from "constructs";
import * as cdk from 'aws-cdk-lib';
import { aws_bedrock as bedrock } from 'aws-cdk-lib';
import { aws_s3 as s3 } from 'aws-cdk-lib';
import * as path from 'path';
import * as fs from 'fs';
import { Permissions } from './permissions';
import { CfnAgentAlias } from 'aws-cdk-lib/aws-bedrock';
import { Bucket } from "aws-cdk-lib/aws-s3";
import { Role } from "aws-cdk-lib/aws-iam";
import { Const } from './const'

export class Agents{

    infoCollectorAgentAlias: CfnAgentAlias;
    processDesignerAgentAlias: CfnAgentAlias;
    rcaAnalyzerAgentAlias: CfnAgentAlias;

    constructor(scope: Construct, stackName: string, props: any){
    
        // get accountID
        const accountID = props.accountID;

        const permissions: Permissions = props.permissions;
        const lambdaRole = permissions.createAgentLambdaRole(stackName, `lambda-role`);
        const agentRole = permissions.createBedrockAgentRole(stackName, `execution-role-for-agents`);

        const bucket = new s3.Bucket(scope, `${stackName}-repo`, {
        bucketName: `${stackName}-repo-${accountID}`,
        autoDeleteObjects: true,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
        });

        this.createInfoCollector(scope, stackName, bucket, lambdaRole, agentRole);
        this.createProcessDesigner(scope, stackName, bucket, lambdaRole, agentRole);
        this.createRcaAnalyzer(scope, stackName, bucket, lambdaRole, agentRole);

    }

    createInfoCollector(scope: Construct, stackName: string, bucket: Bucket, lambdaRole: Role, agentRole: Role){
        // Specify the path to the file you want to upload
        const schemaFilePath = path.join(__dirname, '..', Const.ApiDirectory, Const.InfoCollectorAPI);

        // Upload the file to the S3 bucket
        const schemaFile = new cdk.aws_s3_deployment.BucketDeployment(scope, "info-collector-api", {
            sources: [cdk.aws_s3_deployment.Source.asset(path.dirname(schemaFilePath))],
            destinationBucket: bucket,
            destinationKeyPrefix: Const.ApiDirectory,
            signContent: true
        });

        const infoCollectorFn = new cdk.aws_lambda.Function(scope, 'infoCollectorFn', {
        functionName: `${stackName}-info-collector`,
        runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
        code: cdk.aws_lambda.Code.fromAsset('./functions/info-collector.zip'),
        handler: 'lambda_function.lambda_handler',
        timeout: cdk.Duration.seconds(60),
        environment: {
            // ENDPOINT: process.env.ENDPOINT || 'localhost'
        },
        role: lambdaRole
        })


        const infoCollectorAgent = new bedrock.CfnAgent(scope, `${stackName}-info-collector`, {
            agentName: `${stackName}-info-collector`,

            // the properties below are optional
            actionGroups: [{
                actionGroupName: `${stackName}-info-collector-actions`,
                
                // the properties below are optional
                actionGroupExecutor: {
                    // customControl: 'customControl',
                    lambda: infoCollectorFn.functionArn,
                },
                actionGroupState: 'ENABLED',
                apiSchema: {
                    s3: {
                        s3BucketName: bucket.bucketName,
                        s3ObjectKey: `${Const.ApiDirectory}/${Const.InfoCollectorAPI}`,
                    },
                },
                description: 'collect current account cloudwatch observability data',
                skipResourceInUseCheckOnDelete: false,
            }],
            // agentCollaboration: 'agentCollaboration', // DISABLED | SUPERVISOR | SUPERVISOR_ROUTER
            // agentCollaborators: [{
            //   agentDescriptor: {
            //     aliasArn: 'aliasArn',
            //   },
            //   collaborationInstruction: 'collaborationInstruction',
            //   collaboratorName: 'collaboratorName',

            //   // the properties below are optional
            //   relayConversationHistory: 'relayConversationHistory',
            // }],
            agentResourceRoleArn: agentRole.roleArn,
            autoPrepare: true,
            description: 'collect observability and status data',
            foundationModel: 'amazon.nova-pro-v1:0',
            // guardrailConfiguration: {
            //   guardrailIdentifier: 'guardrailIdentifier',
            //   guardrailVersion: 'guardrailVersion',
            // },
            idleSessionTtlInSeconds: 1800,
            // get instruction text from '../prompts/introduction.txt'
            instruction: fs.readFileSync(path.join(__dirname, '..', Const.PromptsDirectory, Const.InfoCollectorPrompts), 'utf-8'),
            // knowledgeBases: [{
            //   description: 'description',
            //   knowledgeBaseId: 'knowledgeBaseId',

            //   // the properties below are optional
            //   knowledgeBaseState: 'knowledgeBaseState',
            // }],
            // memoryConfiguration: {
            //   enabledMemoryTypes: ['enabledMemoryTypes'],
            //   sessionSummaryConfiguration: {
            //     maxRecentSessions: 123,
            //   },
            //   storageDays: 123,
            // },
            orchestrationType: 'DEFAULT', // Allowed values: DEFAULT | CUSTOM_ORCHESTRATION
            // promptOverrideConfiguration: {
            //   promptConfigurations: [{
            //     additionalModelRequestFields: {},
            //     basePromptTemplate: 'basePromptTemplate',
            //     foundationModel: 'foundationModel',
            //     inferenceConfiguration: {
            //       maximumLength: 123,
            //       stopSequences: ['stopSequences'],
            //       temperature: 123,
            //       topK: 123,
            //       topP: 123,
            //     },
            //     parserMode: 'parserMode',
            //     promptCreationMode: 'promptCreationMode',
            //     promptState: 'promptState',
            //     promptType: 'promptType',
            //   }],

            //   // the properties below are optional
            //   overrideLambda: 'overrideLambda',
            // },
            skipResourceInUseCheckOnDelete: true,
            // tags: {
            //   tagsKey: 'tags',
            // },
            // testAliasTags: {
            //   testAliasTagsKey: 'testAliasTags',
            // },
        });
        this.infoCollectorAgentAlias = new CfnAgentAlias(scope, `${stackName}-info-collector-alias`, {
            agentId: infoCollectorAgent.attrAgentId,
            agentAliasName: `${stackName}-info-collector-alias`,
        });
    }

    createProcessDesigner(scope: Construct, stackName: string, bucket: Bucket, lambdaRole: Role, agentRole: Role){
        const agentPrefixName = 'process-designer'
        const agentId = this.createAgent(scope, stackName, bucket, lambdaRole, agentRole, agentPrefixName, Const.ProcessDesignerAPI, Const.ProcessDesignerPrompts)
        this.processDesignerAgentAlias = new CfnAgentAlias(scope, `${stackName}-${agentPrefixName}-alias`, {
            agentId: agentId,
            agentAliasName: `${stackName}-${agentPrefixName}-alias`,
        });
    }

    createRcaAnalyzer(scope: Construct, stackName: string, bucket: Bucket, lambdaRole: Role, agentRole: Role){
        // Specify the path to the file you want to upload
        const agentPrefixName = 'rca-analyzer'
        const agentId = this.createAgent(scope, stackName, bucket, lambdaRole, agentRole, agentPrefixName, Const.RcaAnalyzerAPI, Const.RcaAnalyzerPrompts)
        this.rcaAnalyzerAgentAlias = new CfnAgentAlias(scope, `${stackName}-${agentPrefixName}-alias`, {
            agentId: agentId,
            agentAliasName: `${stackName}-${agentPrefixName}-alias`,
        });
    }

    createAgent(scope: Construct, stackName: string, bucket: Bucket, lambdaRole: Role, agentRole: Role, agentPrefixName: string, schemaFileName: string, promptsFileName: string){
        // Specify the path to the file you want to upload
        const schemaFilePath = path.join(__dirname, '..', Const.ApiDirectory, schemaFileName);

        // Upload the file to the S3 bucket
        const schemaFile = new cdk.aws_s3_deployment.BucketDeployment(scope, `${agentPrefixName}-api`, {
            sources: [cdk.aws_s3_deployment.Source.asset(path.dirname(schemaFilePath))],
            destinationBucket: bucket,
            destinationKeyPrefix: Const.ApiDirectory,
            signContent: true
        });

        const lambdaFunction = new cdk.aws_lambda.Function(scope, `${agentPrefixName}-function`, {
            functionName: `${stackName}-${agentPrefixName}`,
            runtime: cdk.aws_lambda.Runtime.PYTHON_3_13,
            code: cdk.aws_lambda.Code.fromAsset(`./functions/${agentPrefixName}.zip`),
            handler: 'lambda_function.lambda_handler',
            timeout: cdk.Duration.seconds(60),
            environment: {
                // ENDPOINT: process.env.ENDPOINT || 'localhost'
            },
            role: lambdaRole
        })

        const agent = new bedrock.CfnAgent(scope, `${stackName}-${agentPrefixName}`, {
        agentName: `${stackName}-${agentPrefixName}`,

        // the properties below are optional
        actionGroups: [{
            actionGroupName: `${stackName}-${agentPrefixName}-actions`,
            
            // the properties below are optional
            actionGroupExecutor: {
                // customControl: 'customControl',
                lambda: lambdaFunction.functionArn,
            },
            actionGroupState: 'ENABLED',
            apiSchema: {
                s3: {
                    s3BucketName: bucket.bucketName,
                    s3ObjectKey: `${Const.ApiDirectory}/${schemaFileName}`,
                },
            },
            description: 'decide if information is ready for root cause analysis',
            skipResourceInUseCheckOnDelete: false,
        }],
        agentResourceRoleArn: agentRole.roleArn,
        autoPrepare: true,
        description: 'decide if information is ready for root cause analysis',
        foundationModel: 'amazon.nova-pro-v1:0',
        idleSessionTtlInSeconds: 1800,
        instruction: fs.readFileSync(path.join(__dirname, '..', Const.PromptsDirectory, promptsFileName), 'utf-8'),
        orchestrationType: 'DEFAULT', // Allowed values: DEFAULT | CUSTOM_ORCHESTRATION
        skipResourceInUseCheckOnDelete: true,
        });

        // create dependency
        // agent.addDependency(schemaFile);

        return agent.attrAgentId;
    }

}