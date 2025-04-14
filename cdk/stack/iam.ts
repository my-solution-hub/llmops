import { Construct } from 'constructs'
import { Stack, StackProps } from 'aws-cdk-lib'
import {
  Role,
  RoleProps,
  PolicyDocument,
  ServicePrincipal,
  CompositePrincipal,
  AccountRootPrincipal,
  ManagedPolicy,
  PolicyStatement,
  Effect,
  Policy
} from 'aws-cdk-lib/aws-iam'
import * as fs from 'fs'
import * as path from 'path'

export class IAMStack extends Stack {
  public readonly eksClusterRoleProp: RoleProps
  public readonly eksNodeGroupRoleProp: RoleProps
  public readonly otelAddonRoleArn: string
  public readonly sampleAppRoleProp: RoleProps
  public readonly opensearechSinkRoleArn: string

  constructor (scope: Construct, stackPrefix: string, props?: any) {
    const id = `${stackPrefix}-iam`
    super(scope, id)

    // This is the master role prop for the Eks cluster, it can be used to log in to the cluster for debugging purposes
    this.sampleAppRoleProp = {
      roleName: `${stackPrefix}-sample-app-role`,
      assumedBy: new ServicePrincipal('eks.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AdministratorAccess'),
      ],
      // add secret manager access
      // inlinePolicies: {
      //   DescribeSecretPolicy: new PolicyDocument({
      //     statements: [
      //       new PolicyStatement({
      //         actions: ['secretsmanager:GetSecretValue', 'ssm:GetParameter'],
      //         resources: ['*']
      //       })
      //     ]
      //   })
      // }
    }
    // create a role
    const otelAddonRole = new Role(this, 'CloudwatchAddonRole', {
      roleName: `${stackPrefix}-otel-addon-role`,
      description: 'Role for the Cloudwatch Container Insights Addon',
      assumedBy: new ServicePrincipal('pods.eks.amazonaws.com'),
      inlinePolicies: {
        DescribeSecretPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['sts:AssumeRole', 'sts:TagSession'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('AWSXRayWriteOnlyAccess')
      ]
    })

    otelAddonRole.addToPrincipalPolicy(
      new PolicyStatement({
        effect: Effect.ALLOW,
        actions: ['sts:AssumeRole', 'sts:TagSession'],
        resources: ['*']
      })
    )
    this.otelAddonRoleArn = otelAddonRole.roleArn

    const opensearchSinkRole = new Role(this, 'OpenSearchSinkRole', {
      roleName: `${stackPrefix}-opensearch-sink-role`,
      description: 'Role for the OpenSearch Sink Addon',
      assumedBy: new ServicePrincipal('osis-pipelines.amazonaws.com'),
      inlinePolicies: {
        DescribeSecretPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: [
                'sts:AssumeRole',
              ],
              resources: ['*']
            })
          ]
        }),
        OpenSearchSink: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: [
                'osis:*',
                'es:*',
              ],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonOpenSearchServiceFullAccess')
      ]
    });

    this.eksClusterRoleProp = {
      roleName: `${stackPrefix}-cluster-role`,
      assumedBy: new CompositePrincipal(
        new ServicePrincipal('eks.amazonaws.com'),
        new AccountRootPrincipal()
      ),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSClusterPolicy'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSServicePolicy'),
        ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonEC2ContainerRegistryReadOnly'
        )
      ],
      // Need this policy to assume role and debug the cluster
      inlinePolicies: {
        describeClusterPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['eks:DescribeCluster'],
              resources: ['*']
            })
          ]
        })
      }
    }

    // The node group role must be seperate from the cluster master role
    this.eksNodeGroupRoleProp = {
      roleName: `${stackPrefix}-node-group-role`,
      assumedBy: new ServicePrincipal('ec2.amazonaws.com'),
      inlinePolicies: {
        describeInstancesPolicy: new PolicyDocument({
          statements: [
            new PolicyStatement({
              actions: ['eks-auth:AssumeRoleForPodIdentity'],
              resources: ['*']
            })
          ]
        })
      },
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName(
          'AmazonEC2ContainerRegistryReadOnly'
        ),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKS_CNI_Policy'),
        ManagedPolicy.fromAwsManagedPolicyName('AmazonEKSWorkerNodePolicy')
      ]
    }
  }
}
