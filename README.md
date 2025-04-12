# llmops


```shell
export STACK_NAME=llmops
export APP_VERSION=v0.1
export AWS_REGION=ap-southeast-1
export ACCOUNT=`aws sts get-caller-identity --query "Account" --output text`
ECR_ENDPOINT=${ACOUNT}.dkr.ecr.${AWS_REGION}.amazonaws.com
cdk deploy --all --require-approval never 
```

```shell
aws ecr get-login-password --region $AWS_REGION | docker login --username AWS --password-stdin $ECR_ENDPOINT
docker build . -t llmops-demo:v0.1
docker tag llmops-demo:v0.1  ${ECR_ENDPOINT}/llmops-langchain-demo:v0.1
docker push  ${ECR_ENDPOINT}/llmops-langchain-demo:v0.1

```

openllmetry / langfuse / openlit
