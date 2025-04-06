import { Construct } from 'constructs';
import { Stack, StackProps, CfnOutput, Tags }  from 'aws-cdk-lib';
import { Vpc, SubnetType, IpAddresses } from 'aws-cdk-lib/aws-ec2';
// import { PrivateHostedZone } from 'aws-cdk-lib/aws-route53';

export class NetworkStack extends Stack {
  // Expose properties for use in other stacks
  public readonly vpc: Vpc;

  constructor(scope: Construct, stackPrefix: string, props?: StackProps) {

    const id = `${stackPrefix}-network`;
    super(scope, id, props);
    
    // EKS Cluster needs public and private subnet to initialize
    this.vpc = new Vpc(this, 'DemoVPC', {
      ipAddresses: IpAddresses.cidr("192.168.0.0/16"),
      maxAzs: 2,
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'PublicSubnet',
          subnetType: SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'PrivateEgressSubnet',
          subnetType: SubnetType.PRIVATE_WITH_EGRESS,
        },
      ],
      natGateways: 1,
    });

    // Output the VPC and subnet IDs
    new CfnOutput(this, 'LMLOpsVpcId', {
      value: this.vpc.vpcId,
      description: 'VPC ID',
      exportName: 'LMLOpsVpcId',
    });
  }
}