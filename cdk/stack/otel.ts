import { Construct } from 'constructs'
import { Stack, CfnOutput } from 'aws-cdk-lib'
import * as ec2 from 'aws-cdk-lib/aws-ec2'
import * as iam from 'aws-cdk-lib/aws-iam'
import { Role, ServicePrincipal, ManagedPolicy } from 'aws-cdk-lib/aws-iam'
import * as path from 'path'
import {
  readYamlFile,
  getYamlFiles,
  transformNameToId,
  transformYaml
} from '../util/utils'
import {
  KubernetesManifest,
  Cluster,
  KubernetesObjectValue,
  CfnAddon
} from 'aws-cdk-lib/aws-eks'

export class OtelStack extends Stack {
  private readonly vpc: ec2.Vpc

  private readonly cluster: Cluster
  private readonly ingressManifests: KubernetesManifest[]

  public readonly ingressExternalAddress: KubernetesObjectValue

  private readonly IngressManifestPath = path.join(
    __dirname,
    '..',
    'k8s-manifests/ingress'
  )

  constructor (scope: Construct, stackPrefix: string, props?: any) {
    const id = `${stackPrefix}-otel`
    super(scope, id, props)

    this.vpc = props.vpc
    this.cluster = props.eksCluster


    const namespace = this.cluster.addManifest('ObservabilityNamespace', {
      apiVersion: 'v1',
      kind: 'Namespace',
      metadata: { name: 'observability' }
    });

    const serviceAccount = this.cluster.addServiceAccount('AdotServiceAccount', {
      name: 'adot-collector',
      namespace: 'observability',
    });

    // Add required IAM permissions
    serviceAccount.role.addManagedPolicy(iam.ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy'));
    serviceAccount.role.addToPrincipalPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'logs:PutLogEvents',
        'logs:CreateLogGroup',
        'logs:CreateLogStream',
        'logs:DescribeLogStreams',
        'logs:DescribeLogGroups',
        'cloudwatch:PutMetricData',
        'xray:PutTraceSegments',
        'xray:PutTelemetryRecords',
        'xray:GetSamplingRules',
        'xray:GetSamplingTargets',
        'xray:GetSamplingStatisticSummaries',
        'aps:*',
        'es:DescribeDomain',
        'es:ESHttp*',
        'osis:*',
        'sts:TagSession',
        'ec2:DescribeInstances',
      ],
      resources: ['*'],
    }));

    serviceAccount.node.addDependency(namespace);

    // create security group for ec2 instances
    const sg = new ec2.SecurityGroup(this, 'OtelCollectorSG', {
      vpc: this.vpc,
      allowAllOutbound: true,
      description: 'Security Group for Otel Collector'
    })
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(4317), 'Allow OTLP gRPC')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(4318), 'Allow OTLP HTTP')
    sg.addIngressRule(ec2.Peer.anyIpv4(), ec2.Port.tcp(22), 'Allow ssh')
    this.createOtelCollector(sg)

    this.ingressManifests = this.deployManifests(this.IngressManifestPath, [])

    // install cert-manager
    const certMgr = this.cluster.addHelmChart('CertManager', {
      chart: 'cert-manager',
      repository: 'https://charts.jetstack.io',
      namespace: 'cert-manager',
      createNamespace: true,
      version: 'v1.17.0',
      values: {
        installCRDs: true
      }
    })

    const adotAddon = new CfnAddon(this, 'AdotAddon', {
      addonName: 'adot',
      clusterName: this.cluster.clusterName,
      serviceAccountRoleArn: props.otelAddonRoleArn,
      resolveConflicts: 'OVERWRITE',
    });

    // add dependency for adotAddon to cert-manager
    adotAddon.node.addDependency(certMgr);
  }

  // create an EC2 with Otel Collector Setup
  createOtelCollector (sg: ec2.SecurityGroup) {
    const otelRole = new Role(this, 'OtelEC2Role', {
      assumedBy: new ServicePrincipal('ec2.amazonaws.com')
    })
    otelRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('CloudWatchAgentServerPolicy')
    )
    otelRole.addManagedPolicy(
      ManagedPolicy.fromAwsManagedPolicyName('AWSXrayWriteOnlyAccess')
    )
    const eip = new ec2.CfnEIP(this, 'OtelEC2EIP')

    const otelInstance = new ec2.Instance(this, 'OtelEC2', {
      vpc: this.vpc,
      instanceName: 'Otel-Native',
      instanceType: new ec2.InstanceType('t3.large'),
      machineImage: new ec2.AmazonLinuxImage({
        generation: ec2.AmazonLinuxGeneration.AMAZON_LINUX_2,
        cpuType: ec2.AmazonLinuxCpuType.X86_64
      }),
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      },
      securityGroup: sg,
      role: otelRole,
      blockDevices: [
        {
          deviceName: '/dev/xvda',
          volume: ec2.BlockDeviceVolume.ebs(50)
        }
      ]
    })

    new ec2.CfnEIPAssociation(this, 'OtelEC2EIPAssociation', {
      eip: eip.ref,
      instanceId: otelInstance.instanceId
    })

    otelInstance.addUserData(`
        #!/bin/bash
        dnf update -y
        dnf install -y amazon-cloudwatch-agent curl amazon-ssm-agent

        # Enable and start the SSM Agent
        systemctl enable amazon-ssm-agent
        systemctl start amazon-ssm-agent

        # Install AWS Distro for OTel Collector
        rpm -Uvh https://aws-otel-collector.s3.amazonaws.com/amazon_linux/amd64/latest/aws-otel-collector.rpm

        default yaml file is using cloudwatch and xray

        # Start the OTel Collector in background
        /opt/aws/aws-otel-collector/bin/aws-otel-collector-ctl -a stop
        /opt/aws/aws-otel-collector/bin/aws-otel-collector-ctl -a start
        `)
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
        'demo',
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
}
