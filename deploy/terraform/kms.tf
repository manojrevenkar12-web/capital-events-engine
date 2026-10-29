# One customer-managed key per environment for the database, its secret, the cluster's secrets and logs.
resource "aws_kms_key" "main" {
  description             = "${local.name}: database, secrets, EKS envelope encryption"
  enable_key_rotation     = true
  deletion_window_in_days = 30
}

resource "aws_kms_alias" "main" {
  name          = "alias/${local.name}"
  target_key_id = aws_kms_key.main.key_id
}
