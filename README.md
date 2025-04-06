# llmops


```shell
export STACK_NAME=llmops
cdk deploy --all --require-approval never 
```



```shell
docker build . -t llmops-demo:v0.1
docker tag nutrition-service:latest  ${ECR_ENDPOINT}/${STACK_NAME}/nodejs-petclinic-nutrition-service:${APP_VERSION}
docker push  ${ECR_ENDPOINT}/${STACK_NAME}/nodejs-petclinic-nutrition-service:${APP_VERSION}

```