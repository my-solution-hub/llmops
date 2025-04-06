#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { Constants } from '../lib/const';
import { NetworkStack } from '../stack/networks';
import { OtelStack } from '../stack/otel';
import { IAMStack } from '../stack/iam';
import { InfraStack } from '../stack/infra';
import { AppStack } from '../stack/app-native';

const app = new cdk.App();
const stackName = Constants.stackName;
  
const networkStack = new NetworkStack(app, stackName);
const iamStack = new IAMStack(app, stackName);


const infraStack = new InfraStack(app, stackName, {
  vpc: networkStack.vpc,
  eksClusterRoleProp: iamStack.eksClusterRoleProp,
  eksNodeGroupRoleProp: iamStack.eksNodeGroupRoleProp,
  otelAddonRoleArn: iamStack.otelAddonRoleArn,
  sampleAppRoleProp: iamStack.sampleAppRoleProp,
  appNamespace: Constants.appNamespace,
});

infraStack.addDependency(networkStack);
infraStack.addDependency(iamStack);

const otelStack = new OtelStack(app, stackName, {
  vpc: networkStack.vpc,
  eksCluster: infraStack.cluster,
  otelAddonRoleArn: iamStack.otelAddonRoleArn,
})

otelStack.addDependency(networkStack);
otelStack.addDependency(infraStack);

const appStack = new AppStack(app, stackName, {});
appStack.addDependency(otelStack);
