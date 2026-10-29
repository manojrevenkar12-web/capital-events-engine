output "cluster_name" { value = module.eks.cluster_name }
output "database_endpoint" { value = aws_db_instance.main.address }
output "database_master_secret_arn" { value = aws_db_instance.main.master_user_secret[0].secret_arn }
output "app_secret_name" { value = aws_secretsmanager_secret.app.name }
output "ecr_repositories" { value = { for k, r in aws_ecr_repository.app : k => r.repository_url } }
output "ci_push_role_arn" { value = aws_iam_role.ci_push.arn }
