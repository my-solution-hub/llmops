import { Construct } from 'constructs';
import { Stack, CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as path from 'path';


export class AppStack extends Stack {

    private readonly vpc: ec2.Vpc;
    // Path to the yaml manifests to deploy to EKS
    private readonly IngressManifestPath = path.join(
      __dirname,
      '..',
      'k8s-manifests/ingress'
    )
    constructor(scope: Construct, stackPrefix: string, props?: any) {
        const id = `${stackPrefix}-app`;
        super(scope, id, props);

        this.vpc = props.vpc;
        
        this.createEcrRepo(stackPrefix);

        
    }
    
    // create ECR repo
    createEcrRepo(stackPrefix: string) {
        const repo1 = new ecr.Repository(this, 'EcrRepo', {
            repositoryName: `${stackPrefix}-langchain-demo`,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteImages: true
        });

        const repo2 = new ecr.Repository(this, 'EcrRepo2', {
            repositoryName: `${stackPrefix}-langchain-demo-openlit`,
            removalPolicy: RemovalPolicy.DESTROY,
            autoDeleteImages: true
        });
    }
      
}