import { getGoogleServices } from "./google";

const SPREADSHEET_ID = "1aiOxX9CnaFf75TssMbj3d9fqa3K3pJiRMIPP31BiZX4";

interface DefaultValue {
  // Section defaults
  idSymbol?: string;
  location?: string;
  itemMaterialProduct?: string;
  quantityExtent?: string;
  asbestosType?: string;
  accessibility?: string;
  condition?: string;
  // Action defaults
  actionLabel?: string;
  actionMonitorReinspect?: string;
  actionEncapsulateEnclose?: string;
  actionSafeSystemOfWork?: string;
  actionRemoveCompetentContractor?: string;
  actionRemoveLicensedContractor?: string;
  actionManageAccess?: string;
}

export interface DefaultValues {
  [itemMaterialProduct: string]: {
    [location: string]: DefaultValue;
  };
}

export async function getDefaultValues(): Promise<DefaultValues> {
  try {
    const { sheets } = await getGoogleServices();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: "B2:Z",
    });

    const rows = response.data.values;
    if (!rows || rows.length === 0) {
      console.log("No data found in defaults spreadsheet");
      return {};
    }

    // Convert rows to key-value pairs
    const defaults: DefaultValues = {};

    const headers = rows.shift();

    for (const row of rows) {

      const itemMaterialProduct = row[0]?.toString().trim();
      const location = row[1]?.toString().trim();

      if (!defaults[itemMaterialProduct]) {
        defaults[itemMaterialProduct] = {};
      }

      defaults[itemMaterialProduct][location] = {};

      headers?.forEach((header, index) => {
        const key = header.toString().trim();
        const value = row[index]?.toString().trim();

        if (key && value) {
          (defaults[itemMaterialProduct][location] as any)[key] = value;
        }
      });
    }

    return defaults;
  } catch (error) {
    console.error("Error fetching default values from Google Sheets:", error);
    throw error;
  }
}
