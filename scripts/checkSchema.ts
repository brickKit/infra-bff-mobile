/** make contract-check 用——只验证 contracts/schema.graphql 语法合法，不需要任何真实依赖。 */
import { loadFullSchemaDocument } from "../src/schema.js";

loadFullSchemaDocument();
console.log("✓ contracts/schema.graphql 语法合法");
