import { initializeDeploymentReview } from './review.ts';
import { initializeDeploymentExecution } from './execution.ts';

declare const PROBE_CLASS_HASH: string;
declare const COMPILED_CLASS_HASH: string;
const execution = initializeDeploymentExecution(BigInt(COMPILED_CLASS_HASH));
initializeDeploymentReview(BigInt(PROBE_CLASS_HASH), undefined, undefined, (terms) => execution.setTerms(terms));
