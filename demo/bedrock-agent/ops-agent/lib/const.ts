
export class Const {
	public static readonly stackName = process.env.STACK_NAME || "aiops-demo";


	public static readonly ApiDirectory = "schema";
	public static readonly SsmProcessorAPI = "ssm-processor.yaml";
	public static readonly CliProcessorAPI = "cli-processor.yaml";
	// public static readonly ProcessDesignerAPI = "process-designer.yaml";
	// public static readonly RcaAnalyzerAPI = "rca-analyzer.yaml";

	public static readonly PromptsDirectory = "prompts";
	public static readonly InfoCollectorPrompts = "info-collector-instruction.txt";
	// public static readonly ProcessDesignerPrompts = "process-designer-instruction.txt";
	// public static readonly RcaAnalyzerPrompts = "rca-analyzer-instruction.txt";
}