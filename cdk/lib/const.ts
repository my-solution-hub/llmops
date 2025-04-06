export class Constants {
    public static readonly stackName = process.env.STACK_NAME || "llmops-demo";
    public static readonly appNamespace = process.env.SAMPLE_APP_NAMESPACE || "demo";
    public static readonly templatePrefixName = process.env.TEMPLATE_PREFIX_NAME || this.stackName;
    
    public static readonly CLUSTER_NAME = process.env.CLUSTER_NAME || "llmops-demo";
    // create environment variables for using application signals role
    // public static readonly useAppSignals = process.env.USE_APPLICATION_SIGNALS || "false";
    // public static readonly setSlo = process.env.SET_SLO || "false";

    // public static readonly customDomain = process.env.CUSTOM_DOMAIN || "";
    // public static readonly useCustomDomain = Constants.customDomain == "" ? "false" : "true";

}