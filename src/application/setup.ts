import type { InitialSetupInput } from "../domain/setup.js";

export interface PasswordHasher {
  hash(password: string): Promise<string>;
  verify(password: string, encodedHash: string): Promise<boolean>;
}

export interface SetupTokenVerifier {
  isConfigured(): boolean;
  verify(candidate: string): boolean;
}

export interface CreateInitialAdministratorInput {
  completedAt: string;
  displayName: string;
  passwordHash: string;
  username: string;
  workspaceName: string;
}

export interface SetupResult {
  administrator: {
    displayName: string;
    id: string;
    username: string;
  };
  workspace: {
    id: string;
    name: string;
  };
}

export interface SetupRepository {
  createInitialAdministrator(
    input: CreateInitialAdministratorInput,
  ): SetupResult;
  isSetupComplete(): boolean;
}

export interface SetupStatus {
  required: boolean;
  tokenConfigured: boolean;
}

export class InvalidSetupTokenError extends Error {
  public constructor() {
    super("The setup token is invalid");
    this.name = "InvalidSetupTokenError";
  }
}

export class SetupAlreadyCompleteError extends Error {
  public constructor() {
    super("Initial setup is already complete");
    this.name = "SetupAlreadyCompleteError";
  }
}

export class SetupService {
  public constructor(
    private readonly repository: SetupRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly tokenVerifier: SetupTokenVerifier,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  public getStatus(): SetupStatus {
    return {
      required: !this.repository.isSetupComplete(),
      tokenConfigured: this.tokenVerifier.isConfigured(),
    };
  }

  public async createInitialAdministrator(
    input: InitialSetupInput,
  ): Promise<SetupResult> {
    if (this.repository.isSetupComplete()) {
      throw new SetupAlreadyCompleteError();
    }

    if (!this.tokenVerifier.verify(input.setupToken)) {
      throw new InvalidSetupTokenError();
    }

    const passwordHash = await this.passwordHasher.hash(input.password);

    return this.repository.createInitialAdministrator({
      completedAt: this.clock().toISOString(),
      displayName: input.displayName,
      passwordHash,
      username: input.username,
      workspaceName: input.workspaceName,
    });
  }
}
