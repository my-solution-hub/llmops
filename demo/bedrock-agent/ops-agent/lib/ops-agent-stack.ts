import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { Agents } from './agents';
import { Permissions } from './permissions';

export class OpsAgentStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountID = cdk.Stack.of(this).account;
    const permissions: Permissions = new Permissions(this);
    const properties = {
      accountID: accountID,
      permissions: permissions
    }
    const agents = new Agents(this, id, properties);
  }
}
