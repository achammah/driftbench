import { echoAdapter } from '../../../core/test/runner/support';
import { describeSpec } from '../../src/index';

// A spec that names a project object by id: the CLI loader resolves it from driftbench/ beside driftbench.yaml.
describeSpec('packages/vitest/test/fixtures/blast-objects/specs/uses-project.yaml', echoAdapter('ok'));
