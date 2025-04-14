import * as path from 'path'
import * as fs from 'fs'
import { Construct } from 'constructs'
import * as cdk from 'aws-cdk-lib'
import { StackProps, Stack, CfnJson, CfnOutput } from 'aws-cdk-lib'
import {
  Vpc,
  InstanceType,
  SecurityGroup,
  EbsDeviceVolumeType,
  Peer,
  Port
} from 'aws-cdk-lib/aws-ec2'
import {
  Role,
  RoleProps,
  PolicyStatement,
  FederatedPrincipal,
  Effect,
  AnyPrincipal
} from 'aws-cdk-lib/aws-iam'
import {
  CfnAddon,
  Cluster,
  KubernetesManifest,
  KubernetesVersion,
  ServiceAccount,
  KubernetesObjectValue,
  CfnPodIdentityAssociation,
  AuthenticationMode,
  AlbControllerVersion,
  AlbController,
  HelmChart
} from 'aws-cdk-lib/aws-eks'
import * as eks from 'aws-cdk-lib/aws-eks'
import { KubectlV31Layer } from '@aws-cdk/lambda-layer-kubectl-v31'
import { StringParameter } from 'aws-cdk-lib/aws-ssm'
import { Constants } from '../lib/const'
import { User } from 'aws-cdk-lib/aws-iam'
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager'
import {
  readYamlFile,
  getYamlFiles,
  transformNameToId,
  transformYaml
} from '../util/utils'
import * as opensearch from 'aws-cdk-lib/aws-opensearchservice'
import * as aps from 'aws-cdk-lib/aws-aps'
import { StringAttribute } from 'aws-cdk-lib/aws-cognito'

export class InfraStack extends Stack {
  public readonly CLUSTER_NAME = Constants.CLUSTER_NAME
  private readonly demoServiceAccount = 'demo-service-account'

  private readonly APP_NAMESPACE: string

  private readonly clusterKubernetesVersion = KubernetesVersion.V1_31

  // From StackProp
  private readonly vpc: Vpc
  private readonly eksClusterRole: Role
  private readonly eksNodeGroupRole: Role
  private readonly sampleAppRole: Role

  // Constructs generated in this stack
  public readonly cluster: Cluster
  private readonly sampleAppNamespace: KubernetesManifest
  private readonly ingressManifests: KubernetesManifest[]

  // Ingress External Ip
  public readonly ingressExternalAddress: KubernetesObjectValue

  constructor (scope: Construct, stackPrefix: string, props: any) {
    const id = `${stackPrefix}-infra`
    super(scope, id, props)

    this.vpc = props.vpc
    this.APP_NAMESPACE = props.appNamespace

    // The IAM roles must be created in the EKS stack because some of the roles need to be given federated principals, and this cannot be done if the role is imported
    this.eksClusterRole = new Role(
      this,
      'EksClusterRole',
      props.eksClusterRoleProp
    )
    this.eksNodeGroupRole = new Role(
      this,
      'EksNodeGroupRole',
      props.eksNodeGroupRoleProp
    )
    this.sampleAppRole = new Role(
      this,
      'SampleAppRole',
      props.sampleAppRoleProp
    )

    // Create EKS Cluster
    this.cluster = this.createEksCluster()

    // find role from name
    const eksOwnerRole = Role.fromRoleName(this, 'EksOwnerRole', 'Admin')
    // add EKS access to a role
    this.cluster.awsAuth.addMastersRole(eksOwnerRole)

    this.sampleAppNamespace = this.createNamespace('demo')

    this.createAppServiceServiceAccount(stackPrefix)

    this.createOpensearchCluster(stackPrefix, this.vpc)

    this.createPrometheus(stackPrefix)
  }

  createEksCluster () {
    const cluster = new Cluster(this, 'EKSCluster', {
      clusterName: this.CLUSTER_NAME,
      version: this.clusterKubernetesVersion,
      mastersRole: this.eksClusterRole,
      authenticationMode: AuthenticationMode.API_AND_CONFIG_MAP,
      vpc: this.vpc,
      defaultCapacity: 0,
      // Make sure this version matches the this.clusterKubernetesVersion
      kubectlLayer: new KubectlV31Layer(this, 'kubectl'),
      albController: {
        version: AlbControllerVersion.V2_8_2,
        policy: JSON.parse(
          fs.readFileSync(
            path.join(
              __dirname,
              '..',
              'iam',
              'alb-ingress-controller-policy.json'
            ),
            'utf8'
          )
        )
      }
    })

    //add access using IAM user yagrxu
    const myUser = User.fromUserName(this, 'YagrxuUser', 'yagrxu')
    cluster.grantAccess('yagrxuUser', myUser.userArn, [
      eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
        accessScopeType: eks.AccessScopeType.CLUSTER
      })
    ])

    const adminRole = Role.fromRoleName(this, 'AdminRole', 'Admin')
    cluster.grantAccess('AdminRole', adminRole.roleArn, [
      eks.AccessPolicy.fromAccessPolicyName('AmazonEKSClusterAdminPolicy', {
        accessScopeType: eks.AccessScopeType.CLUSTER
      })
    ])
    // Need at least 3 nodes to support all the pods for the sample app. Alternative is to upgrade the instance type
    // that can support more pods at once
    cluster.addNodegroupCapacity('SampleAppNodeGroup', {
      nodeRole: this.eksNodeGroupRole,
      instanceTypes: [new InstanceType('t3.large')],
      minSize: 5,
      maxSize: 10
    })

    return cluster
  }

  createNamespace (namespace: string) {
    const manifest = this.cluster.addManifest(
      `${transformNameToId(namespace)}Namespace`,
      {
        apiVersion: 'v1',
        kind: 'Namespace',
        metadata: {
          name: namespace
        }
      }
    )
    return manifest
  }

  createAppServiceAccount (
    roleArn: string,
    nsName: string,
    namespace: KubernetesManifest,
    name: string
  ) {
    const serviceAccount = this.cluster.addServiceAccount(name, {
      name: name,
      namespace: nsName,
      annotations: {
        'eks.amazonaws.com/role-arn': roleArn
      }
    })
    // The namespace needs to already exist before creating the service account
    serviceAccount.node.addDependency(namespace)
    return serviceAccount
  }

  createAppServiceServiceAccount (stackPrefix: string) {
    this.addFederatedPrincipal(
      this.sampleAppRole,
      `${stackPrefix}-sample-app-role`,
      true
    )
    return this.createAppServiceAccount(
      this.sampleAppRole.roleArn,
      this.APP_NAMESPACE,
      this.sampleAppNamespace,
      this.demoServiceAccount
    )
  }

  deployManifests (manifestPath: string, dependencies: any[]) {
    let manifests: KubernetesManifest[] = []
    const manifestFiles = getYamlFiles(manifestPath)

    manifestFiles.forEach(file => {
      const filePath = path.join(manifestPath, file)
      const yamlFile = readYamlFile(filePath)
      const transformedYamlFile = transformYaml(
        yamlFile,
        this.account,
        this.region,
        this.APP_NAMESPACE,
        this.ingressExternalAddress?.value
      )
      const manifest = this.cluster.addManifest(
        transformNameToId(file),
        ...transformedYamlFile
      )

      dependencies.forEach(dependnecy => {
        manifest.node.addDependency(dependnecy)
      })
      manifests.push(manifest)
    })
    return manifests
  }

  getIngressExternalIp () {
    const ingressAddress = new KubernetesObjectValue(this, 'IngressAddress', {
      cluster: this.cluster,
      objectType: 'ingress',
      objectName: 'petclinic-ingress',
      objectNamespace: 'pet-clinic',
      jsonPath: '.status.loadBalancer.ingress[0].hostname'
    })

    ingressAddress.node.addDependency(...this.ingressManifests)

    return ingressAddress
  }

  // The role name is required as a parameter because cdk cannot resovlve the rolename of the role at synthesis time
  addFederatedPrincipal (
    role: Role,
    roleName: string,
    isServiceAccount: boolean
  ) {
    const openIdConnectProviderIssuer =
      this.cluster.openIdConnectProvider.openIdConnectProviderIssuer
    const conditionId = roleName + '-OidcCondition'
    const stringCondition = new CfnJson(this, conditionId, {
      value: {
        [`${openIdConnectProviderIssuer}:aud`]: 'sts.amazonaws.com',
        ...(isServiceAccount
          ? {
              [`${openIdConnectProviderIssuer}:sub`]: `system:serviceaccount:${this.APP_NAMESPACE}:${this.demoServiceAccount}`
            }
          : {})
      }
    })

    const federatedPrincipal = new FederatedPrincipal(
      this.cluster.openIdConnectProvider.openIdConnectProviderArn,
      {
        StringEquals: stringCondition
      },
      'sts:AssumeRoleWithWebIdentity'
    )

    role.assumeRolePolicy?.addStatements(
      new PolicyStatement({
        effect: Effect.ALLOW,
        principals: [federatedPrincipal],
        actions: ['sts:AssumeRoleWithWebIdentity']
      })
    )
  }

  createPrometheus (id: string) {
    const workspace = new aps.CfnWorkspace(this, 'ManagedPrometheus', {
      alias: `${id}-prometheus`
    })

    new CfnOutput(this, 'PrometheusWorkspaceId', {
      value: workspace.attrWorkspaceId,
      description: 'The ID of the Managed Prometheus workspace'
    })
  }
  createOpensearchCluster (id: string, vpc: Vpc) {
    const opensearchSecret = new secretsmanager.Secret(
      this,
      'OpenSearchSecret',
      {
        secretName: `${id}-opensearch-log-credentials`,
        generateSecretString: {
          secretStringTemplate: JSON.stringify({ username: 'admin' }),
          generateStringKey: 'password',
          requireEachIncludedType: true,
          excludeCharacters: '@%*()_+=`~{}|[]\\:";\'?,./'
          // excludePunctuation: true,
        }
      }
    )

    const opensearchSecurityGroup = new SecurityGroup(
      this,
      'OpenSearchSecurityGroup',
      {
        vpc,
        description: 'Security group for OpenSearch cluster'
      }
    )
    // opensearchSecurityGroup.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(80), 'Allow HTTP access from anywhere');
    opensearchSecurityGroup.addIngressRule(
      Peer.anyIpv4(),
      Port.tcp(443),
      'Allow HTTPS access from anywhere'
    )

    const opensearchCluster = new opensearch.Domain(this, 'Domain', {
      version: opensearch.EngineVersion.openSearch('2.17'),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      securityGroups: [opensearchSecurityGroup],
      domainName: `${id}-aos-log`,
      capacity: {
        dataNodes: 1,
        multiAzWithStandbyEnabled: false,
        dataNodeInstanceType: 'r7g.large.search',
        masterNodes: 0
      },
      fineGrainedAccessControl: {
        masterUserName: 'admin',
        masterUserPassword: opensearchSecret.secretValueFromJson('password')
      },

      accessPolicies: [
        new PolicyStatement({
          effect: Effect.ALLOW,
          principals: [new AnyPrincipal()],
          actions: ['es:*'],
          resources: ['*']
        })
      ],
      enforceHttps: true,
      zoneAwareness: {
        enabled: false
      },
      ebs: {
        volumeSize: 100,
        volumeType: EbsDeviceVolumeType.GENERAL_PURPOSE_SSD_GP3
      },
      encryptionAtRest: {
        enabled: true
      },
      nodeToNodeEncryption: true,
      logging: {
        slowSearchLogEnabled: true,
        appLogEnabled: true
      }
    })
  }
}
