/**
 * Minimal ambient type declarations for CloudKit JS.
 *
 * CloudKit JS is loaded at runtime from Apple's CDN
 * (https://cdn.apple-cloudkit.com/ck/2/cloudkit.js) rather than an npm
 * dependency, so only the surface the web adapter actually uses is modeled
 * here. See https://developer.apple.com/documentation/cloudkitjs
 */

declare namespace CloudKitJS {
    /** A single CloudKit record field. `value` shape depends on the field type. */
    interface FieldValue {
        value?: unknown;
        type?: string;
    }

    interface RecordFields {
        [key: string]: FieldValue | undefined;
    }

    interface SystemMeta {
        timestamp: number;
        userRecordName: string;
    }

    interface Record {
        recordName: string;
        recordType: string;
        fields: RecordFields;
        recordChangeTag?: string;
        created?: SystemMeta;
        modified?: SystemMeta;
    }

    /** CKAsset field value. */
    interface Asset {
        downloadURL?: string;
        fileChecksum?: string;
        size?: number;
    }

    /** CKLocation field value. */
    interface Location {
        latitude: number;
        longitude: number;
    }

    /** CKReference field value. */
    interface Reference {
        recordName: string;
        action?: string;
        zoneID?: { zoneName: string };
    }

    interface QueryResponse {
        records: Record[];
        continuationMarker?: string;
    }

    interface Query {
        recordType: string;
        filterBy?: unknown[];
        sortBy?: unknown[];
    }

    interface Database {
        performQuery(query: Query, options?: unknown): Promise<QueryResponse>;
        fetchRecords(recordNames: string | string[]): Promise<QueryResponse>;
        saveRecords(records: unknown): Promise<QueryResponse>;
        deleteRecords(records: unknown): Promise<QueryResponse>;
    }

    interface UserIdentity {
        userRecordName: string;
        nameComponents?: { givenName?: string; familyName?: string };
        lookupInfo?: { emailAddress?: string; phoneNumber?: string };
    }

    interface ShareParticipant {
        userIdentity?: UserIdentity;
        role?: number;
        permission?: number;
        acceptanceStatus?: number;
        type?: number;
    }

    interface AuthTokenConfig {
        apiToken: string;
        persist?: boolean;
        signInButton?: { id: string; theme?: string };
        signOutButton?: { id: string; theme?: string };
    }

    interface ContainerConfig {
        containerIdentifier: string;
        apiTokenAuth: AuthTokenConfig;
        environment: 'development' | 'production';
    }

    interface Config {
        containers: ContainerConfig[];
    }

    interface Container {
        publicCloudDatabase: Database;
        privateCloudDatabase: Database;
        sharedCloudDatabase: Database;
        setUpAuth(): Promise<UserIdentity | null>;
        whenUserSignsIn(): Promise<UserIdentity>;
        whenUserSignsOut(): Promise<void>;
        fetchShareParticipants?(options: unknown): Promise<{ participants: ShareParticipant[] }>;
    }

    interface CloudKitStatic {
        configure(config: Config): CloudKitStatic;
        getDefaultContainer(): Container;
        registerImageDownloadURLs?(records: Record[]): void;
    }
}

interface Window {
    CloudKit?: CloudKitJS.CloudKitStatic;
}
