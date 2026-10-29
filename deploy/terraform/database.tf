# MySQL 8.4 on RDS. The session time zone is UTC (the application pins it too: a CET default
# once put DEFAULT CURRENT_TIMESTAMP columns an hour off), TLS is required, and the master
# password lives only in Secrets Manager, rotated by RDS.
resource "aws_db_parameter_group" "mysql" {
  name   = "${local.name}-mysql84"
  family = "mysql8.4"

  parameter {
    name  = "time_zone"
    value = "UTC"
  }
  parameter {
    name  = "require_secure_transport"
    value = "1"
  }
  parameter {
    name  = "transaction_isolation"
    value = "REPEATABLE-READ"
  }
  parameter {
    name  = "innodb_lock_wait_timeout"
    value = "10"
  }
}

resource "aws_security_group" "db" {
  name        = "${local.name}-db"
  description = "MySQL from the EKS nodes only"
  vpc_id      = module.vpc.vpc_id
}

resource "aws_vpc_security_group_ingress_rule" "db_from_nodes" {
  security_group_id            = aws_security_group.db.id
  referenced_security_group_id = module.eks.node_security_group_id
  ip_protocol                  = "tcp"
  from_port                    = 3306
  to_port                      = 3306
}

resource "aws_db_instance" "main" {
  identifier     = local.name
  engine         = "mysql"
  engine_version = "8.4"
  instance_class = var.db_instance_class

  db_name                       = "cee"
  username                      = "cee_admin"
  manage_master_user_password   = true
  master_user_secret_kms_key_id = aws_kms_key.main.arn

  allocated_storage     = var.db_allocated_storage_gb
  max_allocated_storage = var.db_allocated_storage_gb * 4
  storage_type          = "gp3"
  storage_encrypted     = true
  kms_key_id            = aws_kms_key.main.arn

  multi_az               = var.environment == "production"
  db_subnet_group_name   = module.vpc.database_subnet_group_name
  vpc_security_group_ids = [aws_security_group.db.id]
  parameter_group_name   = aws_db_parameter_group.mysql.name
  publicly_accessible    = false

  backup_retention_period         = var.environment == "production" ? 35 : 7
  backup_window                   = "01:00-02:00"
  maintenance_window              = "sun:03:00-sun:04:00"
  copy_tags_to_snapshot           = true
  deletion_protection             = var.environment == "production"
  skip_final_snapshot             = var.environment != "production"
  final_snapshot_identifier       = "${local.name}-final"
  enabled_cloudwatch_logs_exports = ["error", "slowquery"]

  performance_insights_enabled          = true
  performance_insights_kms_key_id       = aws_kms_key.main.arn
  performance_insights_retention_period = 7
  auto_minor_version_upgrade            = true
}
